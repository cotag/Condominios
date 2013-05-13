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
*		* http://docs.angularjs.org/api/ng.$http
*		* http://docs.angularjs.org/api/ng.$q
*
**/


(function(jQuery, angular, undefined) {	// jQuery required for progress event
	'use strict';
	
	angular.module('Condo').

	//
	// Implements the Condo API
	//
	provider('Condo.Api', function() {

		var residencies = {};
		
		this.register = function(provider_name, dependency) {
			residencies[provider_name] = dependency;
		};

		
		this.$get = ['$http', '$rootScope', '$q', '$injector', function($http, $rootScope, $q, $injector) {
			var token = $('meta[name="csrf-token"]').attr('content'),

			
			condoConnection = function(api_endpoint, params) {
				this.endpoint = api_endpoint;		// The API mounting point
				this.params = params;				// Custom API parameters
				
				this.upload_id = null;		// The current upload ID
				this.aborting = false;		// Has the user has requested an abort?
				this.xhr = null;			// Any active cloud file xhr requests
			};


			// Inject the handlers
			angular.forEach(residencies, function(value, key) {
				residencies[key] = $injector.get(value);
			});
			

			$http.defaults.headers = {};
			$http.defaults.headers['common'] = {'X-Requested-With': 'XMLHttpRequest'};
			$http.defaults.headers['post'] = {'X-CSRF-Token': token};
			$http.defaults.headers['put'] = {'X-CSRF-Token': token};
			$http.defaults.headers['delete'] = {'X-CSRF-Token': token};
			
			condoConnection.prototype = {
				
				
				//
				// Creates an entry in the database for the requested file and returns the upload signature
				//	If an entry already exists it returns a parts request signature for resumable uploads
				//
				create: function(options) {		// file_id: 123, options: {} 
					var self = this;
					options = options || {};
					this.aborting = false;
					
					if(!!options['file_id'])
						this.params['file_id'] = options['file_id'];
					
					if(!!options['parameters'])
						this.params['parameters'] = options['parameters'];		// We may be requesting the next set of parts
					
					return $http({
						method: 'POST',
						url: this.endpoint,
						params: this.params
					}).then(function(result){
						result = result.data;
						self.upload_id = result.upload_id;	// Extract the upload id from the results
						
						if (!self.aborting)
							return result;
						else
							return $q.reject(undefined);
					}, function(reason) {
						return $q.reject('upload error');
					});
				},
				
				
				//
				// This requests a chunk signature
				//	Only used for resumable uploads
				//
				edit: function(part_number, part_id) {
					var self = this;
					this.aborting = false;
					
					return $http({
						method: 'GET',
						url: this.endpoint + '/' + this.upload_id + '/edit',
						params: {
							part: part_number,
							file_id: part_id
						}
					}).then(function(result){
						if (!self.aborting)
							return result.data;
						else
							return $q.reject(undefined);
					}, function(reason) {
						return $q.reject('upload error');
					});
				},
				
				
				//
				// If resumable id is present the upload is updated
				//	Otherwise the upload deemed complete
				//
				update: function(params) {	// optional parameters (resumable_id, file_id and part)
					var self = this;
					
					this.aborting = false;
					params = params || {};
						
					return $http({
						method: 'PUT',
						url: this.endpoint + '/' + this.upload_id,
						params: params
					}).then(function(result){
						if (!self.aborting)
							return result.data;
						else
							return $q.reject(undefined);
					}, function(reason) {
						if (reason.status == 401 && params.resumable_id == undefined) {
							return '';		// User may have paused upload as put was being sent. We should let this through just to update the UI
						} else
							return $q.reject('upload error');
					});
				},
				
				
				//
				// Cancels a resumable upload
				//	The actual destruction of the file is handled on the server side as we can't trust the client to do this
				//	We don't care if this succeeds as the back-end will destroy the file eventually anyway.
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
							url: signature.signature.url,
							type: signature.signature.verb,
							headers: signature.signature.headers,
							processData: false,
							success: function(response, textStatus, jqXHR) {
								self.xhr = null;
								result.resolve(response);
							},
							error: function(jqXHR, textStatus, errorThrown) {
								self.xhr = null;
								if (!self.aborting)
									result.reject('upload error');
								else
									result.reject(undefined);
							},
							complete: function(jqXHR, textStatus) {
								if(!$rootScope.$$phase) {
									$rootScope.$apply();					// This triggers the promise response
								}
							}
						};
						
					this.aborting = false;
						
					if (!!self.xhr) {
						result.reject('request in progress');	// This is awesome
						return result.promise;
					}
					
					if(!!signature.data){
						params['data'] = signature.data;
					}
					
					if(!!progress_callback) {
						params['xhr'] = function() {
							var xhr = jQuery.ajaxSettings.xhr();
							if(!!xhr.upload){
								xhr.upload.addEventListener('progress', function(e) {
									if (e.lengthComputable) {
										var phase = $rootScope.$$phase;
										if(phase == '$apply' || phase == '$digest') {
											progress_callback(e.loaded);
										} else {
											$rootScope.$apply(function(){
												progress_callback(e.loaded);
											});
										}
									}
								}, false);
							}
							return xhr;
						};
					}
					
					this.xhr = jQuery.ajax(params);
					
					return result.promise;
				},
				
				
				//
				// Will trigger the error call-back of the xhr object
				//
				abort: function() {
					this.aborting = true;
					if(!!this.xhr) {
						this.xhr.abort();
					}
				}
			};
			
			return {
				//
				// Used to determine what upload strategy to use (Amazon, Google, etc)
				//
				check_provider: function(api_endpoint, the_file, params) {
					params = params || {};
					params['file_size'] = the_file.size;
					params['file_name'] = the_file.name;
					
					if(!!the_file.dir_path)
						params['file_path'] = the_file.dir_path;
					
					return $http({
						method: 'GET',
						url: api_endpoint + '/new',
						params: params
					}).then(function(result){
						if(!!residencies[result.data.residence]) {
							
							var api = new condoConnection(api_endpoint, params);
							
							//
							// TODO:: Check if a file is already in the list and reject if it is
							//
							return residencies[result.data.residence].new_upload(api, the_file);	// return the instantiated provider
							
						} else {
							return $q.reject({
								type: 'error',
								number: 0,
								file: the_file
							});
						}
					}, function(reason) {
						if(reason.status == 406) {
							return $q.reject({
								type: 'warn',
								number: 0,
								details: reason.data,
								file: the_file
							});
						} else {
							return $q.reject({
								type: 'warn',
								number: 1,
								file: the_file
							});
						}
					});
				}
			};
		}];
	});
	
})(jQuery, angular);