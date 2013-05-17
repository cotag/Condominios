/**
*	CoTag Condo Google Strategy
*	Direct to cloud resumable uploads for Google Cloud Storage
*	
*   Copyright (c) 2012 CoTag Media.
*	
*	@author 	Stephen von Takach <steve@cotag.me>
* 	@copyright  2012 cotag.me
* 
* 	
* 	References:
*		* 
*
**/


(function(angular, base64, undefined) {
	'use strict';
	
	angular.module('Condo').
	
	factory('Condo.Google', ['$q', 'Condo.Md5', function($q, md5) {
		var PENDING = 0,
			STARTED = 1,
			PAUSED = 2,
			UPLOADING = 3,
			COMPLETED = 4,
			ABORTED = 5,
		
		
		
		hexToBin = function(input) {
			var result = "", i, length;
			
			if ((input.length % 2) > 0) {
				input = '0' + input;
			}
			
			for (i = 0, length = input.length; i < length; i += 2) {
				result += String.fromCharCode(parseInt(input.slice(i, i + 2), 16));
			}
			
			return result;
		},
		
		
		GoogleCloudStorage = function (api, file) {
			var self = this,
				strategy = null,
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
				api.update().then(function() {
					self.progress = self.size;	// Update to 100%
					self.state = COMPLETED;
				}, defaultError);
			},
			
			
			//
			// We need to sign our uploads so Google can confirm they are valid for us
			//
			build_request = function(chunk) {
				return md5.hash(chunk).then(function(val) {
					return {
						data: chunk,
						data_id: base64.encode(hexToBin(val))
					};
				}, function(reason){
					return $q.reject(reason);
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
				};
				
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
				}).then(function() {
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
			GoogleResumable = function (data, file_hash, finalising) {
				var getQueryParams = function(qs) {
						qs = qs.split("+").join(" ");

						var params = {}, tokens,
						re = /[?&]?([^=]+)=([^&]*)/g;

						while (tokens = re.exec(qs)) {	// NOTE:: we expect the assignment here
							params[decodeURIComponent(tokens[1])] = decodeURIComponent(tokens[2]);
						}

						return params;
					},


					resume_upload = function(request, file_hash, range_start) {
						request.data = file_hash.data;
						api.process_request(request, function(progress) {
							self.progress = range_start + progress;
						}).then(function(result) {
							finalising = true;
							completeUpload();
						}, function(reason) {
							defaultError(reason);
						});
					};

				


				self.state = UPLOADING;
	
				this.resume = function() {
					self.state = UPLOADING;
					if (finalising == true) {
						completeUpload();
					} else {
						api.create({file_id: file_hash.data_id}).
						then(function(data) {
							if(data.type == 'direct_upload') {
								strategy = new GoogleDirect(data);
							} else {
								strategy = new GoogleResumable(data, file_hash);
							}
						}, defaultError);
					}
				};
				
				this.pause = function() {
					api.abort();
				};


				
				api.process_request(data).then(function(response) {
					//
					// Check if we were grabbing a parts list or creating an upload
					//
					if(data.type == 'status') {	// the request was for the byte we are up to
						// Get the byte we were up to here and update the application
						var range_start = parseInt(response[1].getResponseHeader('Range').split('-')[1], 10) + 1;

						build_request(file.slice(range_start)).then(function(result) {
							if (self.state != UPLOADING) {
								return;						// upload was paused or aborted as we were reading the file
							}
							
							api.edit(range_start, result.data_id).
								then(function(data) {
									resume_upload(data, result, range_start);
								}, defaultError);
						
						}, defaultError);	// END BUILD_REQUEST
					} else {
						//
	        			// We've created the upload - we need to update our application with the upload id.
	        			//	This will also return the request for uploading the file which we've already prepared
	        			//
						api.update({
							resumable_id: getQueryParams(response[1].getResponseHeader('Location').split('?')[1]).upload_id,	// grab the upload_id from the Location header
							file_id: file_hash.data_id,
							part: 0						// part for google === the byte we are up to
						}).then(function(data) {
							resume_upload(data, file_hash, 0);	// As this is the first upload attempt we want to upload from byte 0
						}, function(reason) {
							defaultError(reason);
							restart();					// Easier to start from the beginning
						});
					}
				}, function(reason) {
					defaultError(reason);
					restart();		// We need to get a new request signature
				});
			}; // END RESUMABLE
			
			
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
			if (typeof(file.slice) != 'function') {
				file.slice = file.webkitSlice || file.mozSlice;
			}
			
			
			this.start = function(){
				if(strategy == null) {	// We need to create the upload
					
					this.error = false;
					pausing = false;
					this.message = null;
					this.state = STARTED;
					strategy = {};			// This function shouldn't be called twice so we need a state
					
					build_request(file).then(function(result) {
						if (self.state != STARTED) { return; } // upload was paused or aborted as we were reading the file
						
						api.create({file_id: result.data_id}).
							then(function(data) {
								if(data.type == 'direct_upload') {
									strategy = new GoogleDirect(data);
								} else {
									strategy = new GoogleResumable(data, result);
								}
							}, defaultError);
						
					}, defaultError);	// END BUILD_REQUEST
					
					
				} else if (this.state == PAUSED) {				// We need to resume the upload if it is paused
					this.error = false;
					pausing = false;
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
				if(this.state == PAUSED) { this.message = reason; }
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
	}]).

	config(['Condo.ApiProvider', function (ApiProvider) {
		ApiProvider.register('GoogleCloudStorage', 'Condo.Google');
	}]);
	
})(angular, window.base64);
