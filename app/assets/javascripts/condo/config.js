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
* 		* http://docs.angularjs.org/api/AUTO.$provide
*		* http://jsfiddle.net/pkozlowski_opensource/PxdSP/14/
*
**/


(function (angular, undefined) {
	'use strict';
	
	
	//
	// Create a provider for defining the configuration
	//
	angular.module('Condo').
		provider('Condo.Config', function() {
			
			//
			// Controller options
			//
			this.endpoint = '/uploads';		// Default endpoint path
			this.autostart = true;			// Start uploading as soon as the file is added?
			this.ignore_errors = true;		// Continue to autostart after an error?
			this.parallelism = 1;			// number of autostarted uploads at once
			this.size_limit = undefined;	// defaults to unlimited
			this.file_checker = function(file) {		// client side filtering of files
					return true;
			};
			
			//
			// Directive options (specifically for the condo default interface)
			//
			this.delegate = undefined;			// defaults to the condo interface container
			this.drop_targets = undefined;		// defaults to the condo interface container
			this.hover_class = 'drag-hover';	// for styling the interface
			this.supress_notifications = false;	// this prevents js alerts about warnings and errors if you are observing these yourself (Condo.Broadcast)
			
			
			
			this.$get = function() {
				var self = this;
				
				return {
					endpoint: self.endpoint,
					autostart: self.autostart,
					ignore_errors: self.ignore_errors,
					parallelism: self.parallelism,
					file_checker: self.file_checker,
					size_limit: self.size_limit,
					
					delegate: self.delegate,
					drop_targets: self.drop_targets,
					hover_class: self.hover_class,
					supress_notifications: self.supress_notifications
				};
			};
		});
	
})(angular);