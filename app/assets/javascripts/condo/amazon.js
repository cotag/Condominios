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
*		* 
*
**/

(function (factory) {
	if (typeof define === 'function' && define.amd) {
		// AMD
		define(['jquery', 'spark-md5', 'base64', 'condo_uploader'], factory);
	} else {
		// Browser globals
		factory(jQuery, window.SparkMD5, window.base64, window.CondoUploader);
	}
}(function ($, MD5, base64, uploads, undefined) {
	'use strict';
	
	//
	// TODO:: Create an Amazon, google factory etc
	//	We should split all these into different files too (controller and factories separate from directives and views)
	//	So we can have different views for the same controller
	//
	uploads.factory('AmazonS3Condo', ['$q', function($q) {
		var current_uploads = {},
			PENDING = -1,
			STARTED = 0,
			PAUSED = 1,
			UPLOADING = 2,
			COMPLETED = 3,
			ABORTED = 4;
		
		
		
		function hexToBin(input) {
			var result = "";
			
			if ((input.length % 2) > 0) {
				input = '0' + input;
			}
			
			for (var i = 0, length = input.length; i < length; i += 2) {
				result += String.fromCharCode(parseInt(input.slice(i, i + 2), 16));
			}
			
			return result;
		}
		
		
		function Amazon(api, file, options) {
			var self = this,
				strategy = null,
				part_size = 5242880,			// Multi-part uploads should be bigger then this
				part_cache,
				defaultError = function() {
					self.pause('issue with upload');
				};
				
			
			this.state = PENDING;
			this.progress = 0;
			
			//
			// Support file slicing
			//	
			if (typeof(file.slice) != 'function')
				file.slice = file.webkitSlice || file.mozSlice;
			
				
				
			function restart() {
				strategy = null;
			}
			
			
			//
			// We need to sign our uploads so amazon can confirm they are valid for us
			//	Part numbers can be any number from 1 to 10,000 - inclusive
			//
			function build_request(part_number) {
				var result = $q.defer(),
					reader = new FileReader(),
					fail = function(){
						result.reject('file read failed');
					},
					current_part;
				
				if (file.size > part_size) {		// If file bigger then 5mb we expect a chunked upload
					var endbyte = part_number * part_size;
					if (endbyte > file.size)
						endbyte = file.size;
					current_part = file.slice((part_number - 1) * part_size, endbyte);
				} else {
					current_part = file;
				}
				
				
				reader.onload = function(e) {
					part_cache = {data: current_part, data_id: MD5.hashBinary(e.target.result), part_number: part_number};
					result.resolve(part_cache);					// Call the function waiting on the MD5 hash
				};
				reader.onerror = fail;
				reader.onabort = fail;
				reader.readAsBinaryString(current_part);
				
				return result.promise;
			}
			
			
			this.start = function(){
				if(strategy == null) {	// We need to create the upload
					//
					// Update part size if required
					//
					if((part_size * 9999) < file.size)	{
						part_size = file.size / 9999;
						if(part_size > (5 * 1024 * 1024 * 1024)) {		// 5GB limit on part sizes
							this.abort('file too big');
							return;
						}
					}
					
					this.state = STARTED;
					strategy = {};			// This function shouldn't be called twice so we need a state (TODO:: fix this)
					
					build_request(1).then(function(result) {
						if (self.state != STARTED)
							return;						// upload was paused or aborted as we were reading the file
						
						api.create({file_id: base64.encode(hexToBin(result.data_id))}).
							success(function(data, status, headers, config) {
								if(data.type == 'direct_upload') {
									strategy = new AmazonDirect(data);
								} else {
									strategy = new AmazonChunked(data);
								}
							}).
							error(defaultError);
						
					}, function(reason){
						self.pause(reason);
					});	// END BUILD_REQUEST
					
					
				} else if (strategy.state == PAUSED) {				// We need to resume the upload if it is paused
					strategy.resume();
				}
			};
			
			this.pause = function(reason) {
				if(strategy != null && this.state == UPLOADING) {	// Check if the upload is uploading
					this.state = PAUSED;
					strategy.pause();
				} else if (this.state <= STARTED) {
					this.state = PAUSED;
					restart();
				}
			};
			
			this.abort = function(reason) {
				if(strategy != null && strategy.state < FINISHED) {	// Check the upload has not started
					var old_state = this.state;
					
					this.state = ABORTED;
					api.abort();
					
					
					//
					// As we may not have successfully deleted the upload
					//	or we aborted before we received a response from create
					//
					restart();	// nullifies strategy
					
					
					//
					// if we have an upload_id then we should destroy the upload
					//	we won't worry if this fails as it should be automatically cleaned up by the back end
					//
					if(old_state > STARTED) {
						try {
							api.destroy();
						} catch(e) {}
					}
				}
			};
			
			
			//
			// TODO:: We need to remove from current_uploads list
			//	On Abort or Finish (should not be a public interface)
			//
			this.remove = function() {
				if(!!upload_id)
					delete file_list.upload_id;
				
				if(strategy != null) {
					if(strategy.state != STARTED) {
						this.pause();
					} else {
						this.abort();
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
				var $this = this,
					finalising = false;
					
				//
				// Update the parent
				//
				self.state = UPLOADING;
	
				
				//
				// This will only be called when the upload has finished and we need to inform the application
				//
				this.resume = function() {
					self.state = UPLOADING;
					
					api.update().
						success(function(data, status, headers, config) {
							self.state = COMPLETED;
						}).
						error(defaultError);
				}
				
				this.pause = function() {
					if(this.state == UPLOADING) {
						api.abort();
							
						self.state = PAUSED;
						
						if(!finalising) {
							restart();		// Should occur before events triggered
							self.progress = 0;
						}
					}
				};
				
				
				//
				// AJAX for upload goes here
				//
				api.process_request(data, function(progress) {
					self.progress = progress;
				}).then(function(result) {
					finalising = true;
		        	$this.resume();				// Resume informs the application that the upload is complete
				}, function(reason) {
					self.progress = 0;
					defaultError();
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
				var $this = this,
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
			        		xhr = null;
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
								$this.pause('upload error');
								element.trigger('error', [file, self, errorThrown]);
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
						$this.pause('upload error');
						element.trigger('error', [file, self, errorThrown]);
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
								//
								// We don't want to call pause here
								//	as we want resume (or retry) to call resume.
								//
								$this.state = PAUSED;
								element.trigger('paused', [file, self, 'unknown error']);
								element.trigger('error', [file, self, errorThrown]);
							}
						}
					});
				}
					
	
				this.resume = function() {
					this.state = UPLOADING;
					next_part(last_part + 1);
					element.trigger('uploading', [file, self]);
				};
				
				this.pause = function(reason) {
					if(this.state == UPLOADING) {
						if(!!xhr)
							xhr.abort();
							
						this.state = PAUSED;
						element.trigger('paused', [file, self, reason]);
					}
				};
				
				
				
				this.state = UPLOADING;
				
				
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
		        			xhr = null;
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
		        			
		        			last_part = next;		// So we can resume
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
					        		restart();		// Easier to start from the beginning
					        		
					        		if (!(userAborted(jqXHR) && textStatus == 'abort')) {
										$this.pause('upload error');
										element.trigger('error', [file, self, errorThrown]);
									}
								}
							});
		        		}
		        	},
		        	error: function(jqXHR, textStatus, errorThrown) {
		        		xhr = null;
		        		restart();		// We need to get a new request signature
		        		
		        		if (!(userAborted(jqXHR) && textStatus == 'abort')) {
							$this.pause('upload error');
							element.trigger('error', [file, self, errorThrown]);
						}
					}
				});
				
				
				element.trigger('uploading', [file, self]);
			} // END CHUNKED
		} // END AMAZON
		
		
		return {
			new_upload: function(api, file, options) {
				return new Amazon(api, file, options);
			}
		};
		
	}]);
	
}));
