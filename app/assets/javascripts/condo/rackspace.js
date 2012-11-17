/**
*	CoTag Condo Rackspace Cloud Files Strategy
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
		define(['jquery', 'spark-md5', 'condo_uploader'], factory);
	} else {
		// Browser globals
		factory(jQuery, window.SparkMD5, window.CondoUploader);
	}
}(function ($, MD5, uploads, undefined) {
	'use strict';
	
	angular.module('CondoRackspaceProvider', ['CondoUploader']).run(['$rootScope', '$q', 'Condo.Registrar', function($rootScope, $q, registrar) {
		var PENDING = 0,
			STARTED = 1,
			PAUSED = 2,
			UPLOADING = 3,
			COMPLETED = 4,
			ABORTED = 5,
		
		
		Rackspace = function (api, file) {
			var self = this,
				strategy = null,
				part_size = 2097152,			// Multi-part uploads should be bigger then this
				pausing = false,
				defaultError = function(reason) {
					self.error = !pausing;
					pausing = false;
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
			// We need to sign our uploads so rackspace can confirm they are valid for us
			//	TODO:: use http://updates.html5rocks.com/2011/12/Transferable-Objects-Lightning-Fast
			//		where available :)
			//
			build_request = function(part_number) {
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
					result.resolve({
						data: current_part,
						data_id: MD5.hashBinary(e.target.result),
						part_number: part_number
					});
					
					
					if(!$rootScope.$$phase) {
						$rootScope.$apply();					// This triggers the promise response if required
					}
				};
				reader.onerror = fail;
				reader.onabort = fail;
				reader.readAsArrayBuffer(current_part);
				
				return result.promise;
			},

			//
			// Direct file upload strategy
			//
			RackspaceDirect = function(data) {
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
			// Chunked upload strategy--------------------------------------------------
			//
			RackspaceChunked = function (data, first_chunk) {
				//
				// resume
				// abort
				// pause
				//
				var last_part = 0,
				
				//
				// Get the next part signature
				//
				next_part = function(part_number) {
					//
					// Check if we are past the end of the file
					//
					if ((part_number - 1) * part_size < file.size) {
						build_request(part_number).then(function(result) {
							if (self.state != UPLOADING)
								return;						// upload was paused or aborted as we were reading the file
							
							api.update({
								resumable_id: part_number,
								file_id: result.data_id,
								part: part_number
							}).then(function(data) {
								set_part(data, result);
							}, defaultError);
						
						}, defaultError);	// END BUILD_REQUEST
						
					} else {
						//
						// We're after the final commit
						//
						api.edit('finish').
							then(function(request) {
								api.process_request(request).then(completeUpload, defaultError);
							}, defaultError);
					}
				},
				
					
				//
				// Send a part to amazon
				//
				set_part = function(request, part_info) {
					request['data'] = part_info.data;
					api.process_request(request, function(progress) {
						self.progress = (part_info.part_number - 1) * part_size + progress;
					}).then(function(result) {
			        	last_part = part_info.part_number;
			        	next_part(last_part + 1);
					}, function(reason) {
						self.progress = (part_info.part_number - 1) * part_size;
						defaultError(reason);
					});
				};
					

				self.state = UPLOADING;
	
				this.resume = function() {
					self.state = UPLOADING;
					next_part(last_part + 1);
				};
				
				this.pause = function() {
					api.abort();
				};
				
				
				//
				// We need to check if we are resuming or starting an upload
				//
				if(data.type == 'parts') {
					next_part(data.current_part);
				} else {
					set_part(data, first_chunk);
				}
			}; // END CHUNKED
			
			
			//
			// Variables required for all drivers
			//
			this.state = PENDING;
			this.progress = 0;
			this.message = 'pending';
			this.name = file.name;
			this.size = file.size;
			this.error = false;
			
			
			//
			// Support file slicing
			//	
			if (typeof(file.slice) != 'function')
				file.slice = file.webkitSlice || file.mozSlice;
			
			
			this.start = function(){
				if(strategy == null) {	// We need to create the upload
					
					pausing = false;
					this.error = false;
					this.message = null;
					this.state = STARTED;
					strategy = {};			// This function shouldn't be called twice so we need a state (TODO:: fix this)
					
					build_request(1).then(function(result) {
						if (self.state != STARTED)
							return;						// upload was paused or aborted as we were reading the file
						
						api.create({file_id: result.data_id}).
							then(function(data) {
								if(data.type == 'direct_upload') {
									strategy = new RackspaceDirect(data);
								} else {
									strategy = new RackspaceChunked(data, result);
								}
							}, defaultError);
						
					}, defaultError);	// END BUILD_REQUEST
					
					
				} else if (this.state == PAUSED) {				// We need to resume the upload if it is paused
					
					pausing = false;
					this.error = false;
					this.message = null;
					strategy.resume();
				}
			};
			
			this.pause = function(reason) {
				if(strategy != null && this.state == UPLOADING) {	// Check if the upload is uploading
					this.state = PAUSED;
					pausing = true;
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
		}, // END RACKSPACE
		
		
		//
		// Published methods
		//
		publish = {
			new_upload: function(api, file) {
				return new Rackspace(api, file);
			}
		};
		
		
		//
		// Register the residence with the API
		//	Dependency injection succeeded
		//
		registrar.register('RackspaceCloudFiles', publish);
		
		
		return publish;
		
	}]);
	
}));
