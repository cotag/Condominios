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
		define(['jquery', 'base64', 'condo-uploader'], factory);
	} else {
		// Browser globals
		factory(jQuery, window.base64);
	}
}(function ($, base64) {
	'use strict';
	
	angular.module('CondoAmazonProvider', ['CondoUploader', 'CondoAbstractMd5']).run(['$q', 'Condo.Registrar', 'Condo.Md5', function($q, registrar, md5) {
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
		
		
		Amazon = function (api, file) {
			var self = this,
				strategy = null,
				part_size = 5242880,			// Multi-part uploads should be bigger then this
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
					self.progress = self.size;	// Update to 100%
					self.state = COMPLETED;
				}, defaultError);
			},
			
			
			//
			// We need to sign our uploads so amazon can confirm they are valid for us
			//	Part numbers can be any number from 1 to 10,000 - inclusive
			//
			build_request = function(part_number) {
				var current_part;
				
				if (file.size > part_size) {		// If file bigger then 5mb we expect a chunked upload
					var endbyte = part_number * part_size;
					if (endbyte > file.size)
						endbyte = file.size;
					current_part = file.slice((part_number - 1) * part_size, endbyte);
				} else {
					current_part = file;
				}
				
				return md5.hash(current_part).then(function(val) {
					return {
						data: current_part,
						data_id: val,
						part_number: part_number
					}
				}, function(reason){
					return $q.reject(reason);
				});
			},

			//
			// Direct file upload strategy
			//
			AmazonDirect = function(data) {
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
			AmazonChunked = function (data, first_chunk) {
				//
				// resume
				// abort
				// pause
				//
				var part_ids = [],
					last_part = 0,
				
				
				generatePartManifest = function() {
					var list = '<CompleteMultipartUpload>';
					
					for (var i = 0, length = part_ids.length; i < length; i += 1) {
						list += '<Part><PartNumber>' + (i + 1) + '</PartNumber><ETag>"' + part_ids[i] + '"</ETag></Part>';
					}
					list += '</CompleteMultipartUpload>';
					return list;
				},
				
				//
				// Get the next part signature
				//
				next_part = function(part_number) {
					//
					// Check if we are past the end of the file
					//
					if ((part_number - 1) * part_size < file.size) {
						
						self.progress = (part_number - 1) * part_size;	// Update the progress
						
						build_request(part_number).then(function(result) {
							if (self.state != UPLOADING)
								return;						// upload was paused or aborted as we were reading the file
							
							api.edit(part_number, base64.encode(hexToBin(result.data_id))).
								then(function(data) {
									set_part(data, result);
								}, defaultError);
						
						}, defaultError);	// END BUILD_REQUEST
						
					} else {
						//
						// We're after the final commit
						//
						api.edit('finish').
							then(function(request) {
								request['data'] = generatePartManifest();
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
						part_ids.push(part_info.data_id);	// We need to record the list of part IDs for completion
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
				// We need to check if we are grabbing a parts list or creating an upload
				//
				api.process_request(data).then(function(response) {
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
		        			
		        			last_part = next;		// So we can resume
		        			next_part(next + 1);	// As NextPartNumberMarker is just the last part uploaded
		        		} else {
		        			//
		        			// We've created the upload - we need to update the application with the upload id.
		        			//	This will also return the request for uploading the first part which we've already prepared
		        			//
							api.update({
								resumable_id: $(response).find('UploadId').eq(0).text(),
								file_id: base64.encode(hexToBin(first_chunk.data_id)),
								part: 1
							}).then(function(data) {
								set_part(data, first_chunk);		// Parts start at 1
							}, function(reason) {
								defaultError(reason);
								restart();				// Easier to start from the beginning
							});
		        		}
				}, function(reason) {
					defaultError(reason);
					restart();		// We need to get a new request signature
				});
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
			// File path is optional (amazon supports paths as part of the key name)
			//	http://docs.amazonwebservices.com/AmazonS3/2006-03-01/dev/ListingKeysHierarchy.html
			//
			if(!!file.dir_path)
				this.path = file.dir_path;
			
			
			//
			// Support file slicing
			//	
			if (typeof(file.slice) != 'function')
				file.slice = file.webkitSlice || file.mozSlice;
			
			
			this.start = function(){
				if(strategy == null) {	// We need to create the upload
					self.error = false;
					pausing = false;
					
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
					
					this.message = null;
					this.state = STARTED;
					strategy = {};			// This function shouldn't be called twice so we need a state (TODO:: fix this)
					
					build_request(1).then(function(result) {
						if (self.state != STARTED)
							return;						// upload was paused or aborted as we were reading the file
						
						api.create({file_id: base64.encode(hexToBin(result.data_id))}).
							then(function(data) {
								if(data.type == 'direct_upload') {
									strategy = new AmazonDirect(data);
								} else {
									strategy = new AmazonChunked(data, result);
								}
							}, defaultError);
						
					}, defaultError);	// END BUILD_REQUEST
					
					
				} else if (this.state == PAUSED) {				// We need to resume the upload if it is paused
					this.message = null;
					self.error = false;
					pausing = false;
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
		}; // END AMAZON
		
		
		//
		// Register the residence with the API
		//	Dependency injection succeeded
		//
		registrar.register('AmazonS3', {
			new_upload: function(api, file) {
				return new Amazon(api, file);
			}
		});
	}]);
	
}));
