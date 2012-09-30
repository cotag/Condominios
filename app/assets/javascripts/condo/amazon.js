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
	
	
	function Amazon(element, options, file, params) {
		var self = this,
			strategy = null,
			current_part,
			current_id,
			xhr,
			reader = new FileReader();
			
			
		function restart() {
			strategy = null;
		}
		
		function build_request(callback, part_number) {
			if(file.size > part_size) {	// If file bigger then 5mb we expect a chunked upload
				//current_part = get_chunk(part_number);	// TODO:: Do this
			} else {
				current_part = file;
			}
			
			reader.onload = function(e) {
				current_id = base64.encode(hexToBin(MD5.hash({content: e.target.result})));
				callback(part_number);					// Call the function waiting on the MD5 hash
			}
			reader.readAsBinaryString(current_part);
		}
		
		this.start = function(){
			if(strategy == null) {	// We need to create the upload
				element.trigger('started', [file, self]);
				
				strategy = {state: STARTED};	// This function shouldn't be called twice
				
				build_request(function(part_number){
					params = params || {};
					params['file_size'] = file.size;
					params['file_name'] = file.name;
					params['file_id'] = current_id;
					
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
								self.strategy.start();
							}
							else {
								//
								// TODO:: Create a chunked upload handler
								//
							}
						},
						error: function(jqXHR, textStatus, errorThrown) {
							xhr = null;
							element.trigger('error', [file, errorThrown, self, jQuery.parseJSON(jqXHR.responseText)]);
						}
					});
				});
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
				if(strategy.state == STARTED && !!xhr) {		// Abort the call to create
					xhr.abort();
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
			// start
			// resume
			// abort
			// pause
			//
			var upload_id = data.upload_id,
				$this = this;
				
			this.state = UPLOADING;
			
			
			this.start = function() {
				if(this.state == UPLOADING && !xhr) {
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
			        		$this.resume();
			        	},
			        	error: function(jqXHR, textStatus, errorThrown) {
			        		xhr = null;
							element.trigger('error', [file, errorThrown, self]);
							$this.pause('upload failed');
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
				}
			};
			
			//
			// This will only be called when the upload has finished and we need to inform the application
			//
			this.resume = function() {
				xhr = $.ajax({
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
						element.trigger('error', [file, errorThrown, self]);
						//
						// We don't want to call pause here
						//	as we want resume (or retry) to call resume.
						//
						$this.state = PAUSED;
						element.trigger('paused', [file, self, 'unknown error']);
					}
				});
			}
			
			this.pause = function(reason) {
				if(this.state == UPLOADING) {
					if(!!xhr)
						xhr.abort();
					this.state = PAUSED;
					element.trigger('paused', [file, self, reason]);
					element.trigger('progress', [file, 0]);
					restart();
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
					restart();
				}
			};
		}
		
		
		
		
		//
		// TODO:: Chunked upload strategy
		//
		
		
		
	}
	
	
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
