/**
*	CoTag Condo
*	Direct to cloud resumable uploads
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
*		* http://docs.angularjs.org/api/ng.$http
*		* http://docs.angularjs.org/api/ng.$q
*
**/

(function (factory) {
	if (typeof define === 'function' && define.amd) {
		// AMD
		define('condo_uploader', ['jquery'], factory);
	} else {
		// Browser globals
		window.CondoUploader = factory(jQuery);
	}
}(function ($, undefined) {
	'use strict';
	
	var uploads = angular.module('CondoUploader', []);
	
	
	//
	// Implements the Condo API
	//
	uploads.factory('Condo.Api', ['$http', '$q', 'Condo.AmazonS3', function($http, $q, AmazonS3Condo) {
		
		
		var token = $('meta[name="csrf-token"]').attr('content'),
			residencies = {
				AmazonS3: AmazonS3Condo
			};
		
		$http.defaults.headers = {};
		$http.defaults.headers['common']['X-Requested-With'] = 'XMLHttpRequest';
		$http.defaults.headers['post']['X-CSRF-Token'] = token;
		$http.defaults.headers['put']['X-CSRF-Token'] = token;
		$http.defaults.headers['delete']['X-CSRF-Token'] = token;

		
		function condoConnection(api_endpoint, params) {
			this.endpoint = api_endpoint;		// The API mounting point
			this.params = params;				// Custom API parameters
			
			this.upload_id = null;		// The current upload ID
			this.aborting = false;		// Has the user has requested an abort?
			this.xhr = null;			// Any active cloud file xhr requests
		}
		
		condoConnection.prototype = {
			
			
			//
			// Creates an entry in the database for the requested file and returns the upload signature
			//	If an entry already exists it returns a parts request signature for resumable uploads
			//
			create: function(options) {		// file_id: 123, options: {} 
				var self = this;
				options = options || {};
				
				if(!!options['file_id'])
					this.params['file_id'] = options['file_id'];
				
				if(!!options['options'])
					this.params['object_options'] = options['options'];		// We may be requesting the next set of parts
				
				return $http({
					method: 'POST',
					url: this.endpoint,
					params: this.params
				}).then(function(result){
					self.upload_id = result.upload_id;	// Extract the upload id from the results
					delete result.upload_id;
					return result;
				});
			},
			
			
			//
			// This requests a chunk signature
			//	Only used for resumable uploads
			//
			edit: function(part_number, part_id) {
				return $http({
					method: 'GET',
					url: this.endpoint + '/' + this.upload_id + '/edit',
					params: {
						part: part_number,
						file_id: part_id
					}
				});
			},
			
			
			//
			// If resumable id is present the upload is updated
			//	Otherwise the upload deemed complete
			//
			update: function(params) {	// optional parameters (resumable_id, file_id and part)
				params = params || {};
					
				return $http({
					method: 'PUT',
					url: this.endpoint + '/' + this.upload_id,
					params: params
				});
			},
			
			
			//
			// Cancels a resumable upload
			//	The actual destruction of the file is handled on the server side as we can't trust the client to do this
			//
			destroy: function() {
				return $http({
					method: 'DELETE',
					url: this.endpoint + '/' + this.upload_id
				});
			},
			
			
			
			//
			// Provides a promise for any request this is what communicated with the cloud storage servers
			//
			process_request: function(signature, progress_callback) {
				var self = this,
					result = $q.defer(),
					params = {
						url: signature.url,
						type: signature.verb,
						headers: signature.headers,
						processData: false,
						success: function(response, textStatus, jqXHR) {
							self.xhr = null;
							result.resolve(response);
						},
						error: function(jqXHR, textStatus, errorThrown) {
							self.xhr = null;
							result.reject('upload failed');
						}
					};
					
				if (!!self.xhr) {
					result.reject('request in progress');	// This is awesome
					return result.promise;
				}
				
				if(!!signature.data){
					params['data'] = signature.data;
				}
				
				if(!!progress_callback) {
					params['xhr'] = function() {
						var xhr = $.ajaxSettings.xhr();
						if(!!xhr.upload){
							xhr.upload.addEventListener('progress', function(e) {
								if (e.lengthComputable) {
									progress_callback(e.loaded);			// Callback we'll need to wrap these in an apply to update the view
								}
							}, false);
						}
						return xhr;
					};
				}
				
				self.xhr = $.ajax(params);
				
				return result.promise;
			},
			
			
			//
			// Will trigger the error call-back of the xhr object
			//
			abort: function() {
				if(!!this.xhr) {
					this.xhr.abort();
				} else {
					this.aborting = true;		// TODO:: we need to reject requests if abort was set
				}
			}
		};
		
		return {
			//
			// Used to determine what upload strategy to use (Amazon, Google, etc)
			//
			check_provider: function(api_endpoint, the_file, options, params) {
				params = params || {};
				params['file_size'] = the_file.size;
				params['file_name'] = the_file.name;
				
				return $http({
					method: 'GET',
					url: api_endpoint + '/new',
					params: params
				}).then(function(result){
					if(!!residencies[result.residence]) {
						
						var api = new condoConnection(api_endpoint, params);
						
						//
						// TODO:: Check if a file is already in the list and reject if it is
						//
						return residencies[result.residence].new_upload(api, the_file, options);	// return the instantiated provider
						
					} else {
						return $q.reject('provider not found');
					}
				});
			}
		};
	}]);
	
	
	
	//
	// Anonymous function return
	//
	return uploads;
	
}));