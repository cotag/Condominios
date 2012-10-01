/**
*	CoTag Condo Amazon S3 Strategy
*	Direct to cloud resumable uploads for Amazon S3
*	
*   Copyright (c) 2012 CoTag Media.
*	
*	@author 	Stephen von Takach <steve@cotag.me>
* 	@copyright  2012 cotag.me
* 
* 	
* 	References:
* 		* https://github.com/umdjs/umd
* 		* https://github.com/addyosmani/jquery-plugin-patterns
*
**/

(function (factory) {
	if (typeof define === 'function' && define.amd) {
		// AMD
		define(['jquery', 'spark_md5', 'base64'], factory);
	} else {
		// Browser globals
		factory(jQuery, window.md5, window.base64);
	}
}(function ($, MD5, base64, undefined) {
	'use strict';
	
	var part_size = 5242880,	// NOTE:: This must match the server side part size
		STARTED = 0,
		PAUSED = 1,
		UPLOADING = 2,
		COMPLETED = 3,
		ABORTED = 4;
		
	
	function hexToBin(input) {
		var result = "";
		
		if((input.length % 2) > 0)
			input = '0' + input;
		
		for (var i = 0, length = input.length; i < length; i += 2) {
			result += String.fromCharCode(parseInt(input.slice(i, i + 2), 16));
		}
		
		return result;
	}
	
	function userAborted(xhr) {
		return !xhr.getAllResponseHeaders();
	}
	
	
	function Amazon(element, options, file, params) {
		var self = this,
			strategy = null,
			current_part,
			current_id,
			xhr,
			reader = new FileReader();
			
		
		//
		// Support file slicing
		//	
		if(typeof(file.slice) != 'function')
			file.slice = file.webkitSlice || file.mozSlice;
			
			
		function restart() {
			strategy = null;
		}
		
		
		//
		// We need to sign our uploads so amazon can confirm they are valid for us
		//	Part numbers can be any number from 1 to 10,000 - inclusive
		//
		function build_request(callback, part_number) {
			if(file.size > part_size) {		// If file bigger then 5mb we expect a chunked upload
				var endbyte = part_number * part_size;
				if (endbyte > file.size)
					endbyte = file.size;
				current_part = file.slice((part_number - 1) * part_size, endbyte);
			} else {
				current_part = file;
			}
			
			reader.onload = function(e) {
				current_id = MD5.hash({content: e.target.result});
				callback(part_number);					// Call the function waiting on the MD5 hash
			}
			reader.readAsBinaryString(current_part);
		}
		
		this.start = function(){
			if(strategy == null) {	// We need to create the upload
				element.trigger('started', [file, self]);
				
				strategy = {state: STARTED};	// This function shouldn't be called twice
				
				build_request(function(part_number){
					if (strategy.state != STARTED)
						return;						// upload was aborted
					
					params = params || {};
					params['file_size'] = file.size;
					params['file_name'] = file.name;
					params['file_id'] = base64.encode(hexToBin(current_id));
					
					xhr = $.ajax({
						type: 'POST',
						url: options.api_endpoint,
						data: {upload: params},
						dataType: 'json',
						success: function(data, textStatus, jqXHR) {
							//upload_id = data.upload_id;
							xhr = null;
							if(data.type == 'direct_upload') {
								//
								// Create a direct upload handler
								//
								self.strategy = new AmazonDirect(data);
							}
							else {
								//
								// Create a chunked upload handler
								//
								self.strategy = new AmazonChunked(data);
							}
						},
						error: function(jqXHR, textStatus, errorThrown) {
							xhr = null;
							if (!(userAborted(jqXHR) && textStatus == 'abort')) {
								element.trigger('error', [file, errorThrown, self, jQuery.parseJSON(jqXHR.responseText)]);
							}
						}
					});
				}, 1);	// END BUILD_REQUEST
			} else if (strategy.state == PAUSED) {				// We need to resume the upload if it is paused
				strategy.resume();
			}
		};
		
		this.pause = function(reason) {
			if(strategy != null && strategy.state == UPLOADING) {	// Check if the upload is uploading
				strategy.pause();
			}
		};
		
		this.abort = function() {
			if(strategy != null && strategy.state < FINISHED) {	// Check the upload has not started
				if(strategy.state == STARTED) {
					if(!!xhr)					// Abort the call to create
						xhr.abort();			// We could be building the request so we need to update the state regardless
					
					strategy.state = ABORTED;
					element.trigger('aborted', [file, self]);
				} else {
					strategy.abort();
				}
			}
		};
		
		//
		// Direct file upload strategy
		//
		function AmazonDirect(data) {
			//
			// resume
			// abort
			// pause
			//
			var upload_id = data.upload_id,
				$this = this,
				finalising = false;

			
			//
			// This will only be called when the upload has finished and we need to inform the application
			//
			this.resume = function() {
				xhr = $.ajax({				// NOTE:: Almost exactly the same as for resumable uploads (Update both, not very dry I know.)
					type: 'POST',
					url: options.api_endpoint + '/' + upload_id,
					data: {
						'_method':'PUT'
					},
		        	success: function(){
		        		xhr = null;
		        		$this.state = COMPLETED;
						element.trigger('completed', [file, self]);
		        	},
		        	error: function(jqXHR, textStatus, errorThrown) {
		        		xhr = null;
		        		if (!(userAborted(jqXHR) && textStatus == 'abort')) {
							element.trigger('error', [file, errorThrown, self]);
							//
							// We don't want to call pause here
							//	as we want resume (or retry) to call resume.
							//
							$this.state = PAUSED;
							element.trigger('paused', [file, self, 'unknown error']);
						}
					}
				});
			}
			
			this.pause = function(reason) {
				if(this.state == UPLOADING) {
					if(!!xhr)
						xhr.abort();
						
					this.state = PAUSED;
					element.trigger('paused', [file, self, reason]);
					
					if(!finalising) {
						element.trigger('progress', [file, 0]);
						restart();
					}
				}
			};
			
			this.abort = function() {
				//
				// Check what state we are at with the current file
				//
				if(this.state < FINISHED) {
					if(!!xhr)
						xhr.abort();
					
					//
					// AJAX request to destroy the upload
					//	(we won't worry if this fails as it should be automatically cleaned up by the back end)
					//
					$.ajax({
						type: 'POST',
						url: options.api_endpoint + '/' + upload_id,
						data: {'_method':'DELETE'}
					});
					
					this.state = ABORTED;
					element.trigger('aborted', [file, self]);
					restart();	// Might be needed if called during resume
				}
			};
			
			
			
			this.state = UPLOADING;
			element.trigger('uploading', [file, self]);
			//
			// AJAX for upload goes here
			//
			$.ajax({
				url: data.signature.url,
				type: data.signature.verb,
				data: current_part,
	        	processData: false,
	        	headers: data.signature.headers,
	        	success: function(){
	        		finalising = true;
	        		$this.resume();		// Resume informs the application that the upload is complete
	        	},
	        	error: function(jqXHR, textStatus, errorThrown) {
	        		xhr = null;
	        		if (!(userAborted(jqXHR) && textStatus == 'abort')) {
						element.trigger('error', [file, errorThrown, self]);
						$this.pause('upload failed');
					}
				},
	        	xhr: function() {
					xhr = $.ajaxSettings.xhr();
					if(!!xhr.upload){
						xhr.upload.addEventListener("progress", function(e) {
							if (e.lengthComputable) {
								element.trigger('progress', [file, e.loaded]);
							}
						}, false);
					}
					return xhr;
				}
			});
		} // END DIRECT
		
		
		
		//
		// Chunked upload strategy--------------------------------------------------
		//
		function AmazonChunked(data) {
			//
			// resume
			// abort
			// pause
			//
			var upload_id = data.upload_id,	// This is the applications upload reference (not amazon's)
				$this = this,
				part_ids = [],
				last_part = 0;
				
			
			
			//
			// Get the next part request
			//
			function next_part(part_number) {
				//
				// Check if we are past the end of the file
				//
				if ((part_number - 1) * part_size < file.size) {
					build_request(function(part_number){
						if ($this.state != UPLOADING)
							return;						// upload was aborted
						
						xhr = $.ajax({
							type: 'GET',
							url: options.api_endpoint + '/' + upload_id + '/edit',
							data: {
								file_id: base64.encode(hexToBin(current_id)),
								part: part_number
							},
							dataType: 'json',
							success: function(data, textStatus, jqXHR) {
								set_part(data, part_number);
							},
							error: commonError
						});
					}, part_number);	// END BUILD_REQUEST
					
				} else {
					//
					// We're after the final commit
					//
					xhr = $.ajax({
						type: 'GET',
						url: options.api_endpoint + '/' + upload_id + '/edit',
						data: {
							part: 'finish'
						},
						dataType: 'json',
						success: function(req, textStatus, jqXHR) {
							xhr = $.ajax({
								url: req.signature.url,
								type: req.signature.verb,
								data: generatePartManifest(),
								processData: false,
					        	headers: req.signature.headers,
					        	success: completeUpload,
					        	error: commonError
							});
						},
						error: commonError
					});
				}
			}
			
				
			//
			// Get the send a part to amazon
			//
			function set_part(request, part_number) {
				$.ajax({
					url: request.signature.url,
					type: request.signature.verb,
					data: current_part,
		        	processData: false,
		        	headers: request.signature.headers,
		        	success: function() {
		        		part_ids.push(current_id);	// We need to record the list of part IDs for completion
		        		last_part = part_number;
		        		next_part(part_number + 1);
		        	},
		        	error: function(jqXHR, textStatus, errorThrown) {
		        		xhr = null;
		        		if (!(userAborted(jqXHR) && textStatus == 'abort')) {
		        			//
			        		// TODO:: We want to retry this on failure
			        		//
		        			element.trigger('error', [file, errorThrown, self]);
							$this.pause('upload failed');
		        		}
						element.trigger('progress', [file, (part_number - 1) * part_size]);
					},
		        	xhr: function() {
						xhr = $.ajaxSettings.xhr();
						if(!!xhr.upload){
							xhr.upload.addEventListener("progress", function(e) {
								if (e.lengthComputable) {
									element.trigger('progress', [file, (part_number - 1) * part_size + e.loaded]);
								}
							}, false);
						}
						return xhr;
					}
				});
			}
			
			
			function commonError(jqXHR, textStatus, errorThrown) {
				xhr = null;
        		if (!(userAborted(jqXHR) && textStatus == 'abort')) {
					element.trigger('error', [file, errorThrown, self]);
					$this.pause('upload failed');
				}
			}
			
			
			function generatePartManifest() {
				var list = '<CompleteMultipartUpload>';
				
				for (var i = 0, length = part_ids.length; i < length; i += 1) {
					list += '<Part><PartNumber>' + (i + 1) + '</PartNumber><ETag>"' + part_ids[i] + '"</ETag></Part>';
				}
				list += '</CompleteMultipartUpload>';
				return list;
			}
			
			
			function completeUpload() {
				xhr = $.ajax({				// NOTE:: Almost exactly the same as for direct uploads (Update both, not very dry I know.)
					type: 'POST',
					url: options.api_endpoint + '/' + upload_id,
					data: {
						'_method':'PUT'
					},
		        	success: function(){
		        		xhr = null;
		        		$this.state = COMPLETED;
						element.trigger('completed', [file, self]);
		        	},
		        	error: function(jqXHR, textStatus, errorThrown) {
		        		xhr = null;
		        		if (!(userAborted(jqXHR) && textStatus == 'abort')) {
							element.trigger('error', [file, errorThrown, self]);
							//
							// We don't want to call pause here
							//	as we want resume (or retry) to call resume.
							//
							$this.state = PAUSED;
							element.trigger('paused', [file, self, 'unknown error']);
						}
					}
				});
			}
				

			
			//
			// This will only be called when the upload has finished and we need to inform the application
			//
			this.resume = function() {
				
			}
			
			this.pause = function(reason) {
				if(this.state == UPLOADING) {
					
				}
			};
			
			this.abort = function() {
				//
				// Check what state we are at with the current file
				//
				if(this.state < FINISHED) {
					
				}
			};
			
			
			
			this.state = UPLOADING;
			element.trigger('uploading', [file, self]);
			
			//
			// We need to check if we are grabbing a parts list or creating an upload
			//
			xhr = $.ajax({
				url: data.signature.url,
				type: data.signature.verb,
	        	headers: data.signature.headers,
	        	dataType: 'xml',
	        	success: function(response, textStatus, jqXHR){
	        		if(data.type == 'parts') {	// was the original request for a list of parts
	        			//
	        			// NextPartNumberMarker == the final part in the current request
	        			//	TODO:: if IsTruncated is set then we need to keep getting parts
	        			//
	        			response = $(response);
	        			var next = parseInt(response.find('NextPartNumberMarker').eq(0).text()),
	        				etags = response.find('ETag');
	        			
	        			etags.each(function(index) {
	        				part_ids.push($(this).text().replace(/"{1}/gi,''));	// Removes " from strings
	        			});
	        			
	        			next_part(next + 1);	// As NextPartNumberMarker is just the last part uploaded
	        		} else {
	        			//
	        			// We've created the upload - we need to update the application with the upload id.
	        			//	This will also return the request for uploading the first part which we've already prepared
	        			//
	        			xhr = $.ajax({
							type: 'POST',
							url: options.api_endpoint + '/' + upload_id,
							data: {
								'_method':'PUT',
								resumable_id: $(response).find('UploadId').eq(0).text(),
								file_id: base64.encode(hexToBin(current_id)),
								part: 1
							},
				        	success: function(req){
				        		set_part(req, 1);			// Parts start at 1
				        	},
				        	error: function(jqXHR, textStatus, errorThrown) {
				        		xhr = null;
				        		if (!(userAborted(jqXHR) && textStatus == 'abort')) {
									element.trigger('error', [file, errorThrown, self]);
									$this.pause('upload failed');
								}
								restart();		// Easier to start from the beginning
							}
						});
	        		}
	        	},
	        	error: function(jqXHR, textStatus, errorThrown) {
	        		xhr = null;
	        		if (!(userAborted(jqXHR) && textStatus == 'abort')) {
						element.trigger('error', [file, errorThrown, self]);
						$this.pause('upload failed');
					}
					restart();		// We need to get a new request signature
				}
			});
		} // END CHUNKED
	} // END AMAZON
	
	
	//
	// Create the namespace if it doesn't exist yet
	//
	if (!$.condo) {
		$.condo = {
			strategies: {}
		}
	}
	
	$.condo.strategies['AmazonS3'] = Amazon;
}));
