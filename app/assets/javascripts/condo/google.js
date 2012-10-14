/**
*	CoTag Condo Amazon S3 Strategy
*	Direct to cloud resumable uploads for Google Cloud Storage
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
	uploads.factory('Condo.GoogleCloudStorage', ['$rootScope', '$q', function($rootScope, $q) {
		var PENDING = 0,
			STARTED = 1,
			PAUSED = 2,
			UPLOADING = 3,
			COMPLETED = 4,
			ABORTED = 5,
		
		
		
		hexToBin = function(input) {
			var result = "";
			
			if ((input.length % 2) > 0) {
				input = '0' + input;
			}
			
			for (var i = 0, length = input.length; i < length; i += 2) {
				result += String.fromCharCode(parseInt(input.slice(i, i + 2), 16));
			}
			
			return result;
		},
		
		
		GoogleCloudStorage = function (api, file) {
			var self = this,
				strategy = null,
				part_size = 1048576,	// This is the amount of the file we read into memory as we are building the hash (1mb)
				defaultError = function(reason) {
					self.pause(reason);
				},

			restart = function() {
				strategy = null;
			},


			completeUpload = function() {
				api.update().then(function(data) {
						self.state = COMPLETED;
				}, defaultError);
			},
			
			
			//
			// We need to sign our uploads so Google can confirm they are valid for us
			//	TODO:: use http://updates.html5rocks.com/2011/12/Transferable-Objects-Lightning-Fast
			//		where available :) - especially important since we have to hash the entire file
			//
			build_request = function(part_number, hash) {
				var result = $q.defer(),
					reader = new FileReader(),
					fail = function(){
						result.reject('file read failed');
					},
					current_part;
					
				if (part_number == 1) {
					hash = new MD5();
				}
				
				if (file.size > part_size) {		// If file bigger then 5mb we expect a chunked upload
					var endbyte = part_number * part_size;
					if (endbyte > file.size)
						endbyte = file.size;
					current_part = file.slice((part_number - 1) * part_size, endbyte);
				} else {
					current_part = file;
				}
				
				reader.onload = function(e) {
					hash.appendBinary(e.target.result);
					result.resolve(hash);
					
					
					if(!$rootScope.$$phase) {
						$rootScope.$apply();					// This triggers the promise response if required
					}
				};
				reader.onerror = fail;
				reader.onabort = fail;
				reader.readAsBinaryString(current_part);
				
				//
				// Chaining promises means the UI will have a chance to update
				//
				return result.promise.then(function(val){
					if ((part_number * part_size) < file.size) {
						return build_request(part_number + 1, val);
					} else {
						return {
							data: file,
							data_id: base64.encode(hexToBin(val.end()))
						}
					}
				}, function(reason){
					$q.reject(reason);
				});
			},

			//
			// Direct file upload strategy
			//
			GoogleDirect = function(data) {
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
					completeUpload();
				}
				
				this.pause = function() {
					api.abort();
						
					if(!finalising) {
						restart();		// Should occur before events triggered
						self.progress = 0;
					}
				};
				
				
				//
				// AJAX for upload goes here
				//
				data['data'] = file;
				api.process_request(data, function(progress) {
					self.progress = progress;
				}).then(function(result) {
					finalising = true;
		        	$this.resume();				// Resume informs the application that the upload is complete
				}, function(reason) {
					self.progress = 0;
					defaultError(reason);
				});
			}, // END DIRECT


			//
			// Resumable upload strategy--------------------------------------------------
			//
			GoogleResumable = function (data, first_chunk) {
				
			}; // END RESUMABLE
			
			
			//
			// Variables required for all drivers
			//
			this.state = PENDING;
			this.progress = 0;
			this.message = 'pending';
			this.name = file.name;
			this.size = file.size;
			
			
			//
			// Support file slicing
			//	
			if (typeof(file.slice) != 'function')
				file.slice = file.webkitSlice || file.mozSlice;
			
			
			this.start = function(){
				if(strategy == null) {	// We need to create the upload
					
					this.message = null;
					this.state = STARTED;
					strategy = {};			// This function shouldn't be called twice so we need a state
					
					build_request(1).then(function(result) {
						if (self.state != STARTED)
							return;						// upload was paused or aborted as we were reading the file
						
						api.create({file_id: result.data_id}).
							then(function(data) {
								if(data.type == 'direct_upload') {
									strategy = new GoogleDirect(data);
								} else {
									strategy = new GoogleResumable(data, result);
								}
							}, defaultError);
						
					}, function(reason){
						self.pause(reason);
					});	// END BUILD_REQUEST
					
					
				} else if (this.state == PAUSED) {				// We need to resume the upload if it is paused
					this.message = null;
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
				if(this.state == PAUSED)
					this.message = reason;
			};
			
			this.abort = function(reason) {
				if(strategy != null && this.state < COMPLETED) {	// Check the upload has not finished
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
						api.destroy();
					}
					
					this.message = reason;
				}
			};
		}; // END GOOGLE
		
		
		return {
			new_upload: function(api, file) {
				return new GoogleCloudStorage(api, file);
			}
		};
		
	}]);
	
}));
