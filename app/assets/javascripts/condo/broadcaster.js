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
		define('condo-broadcaster', factory);
	} else {
		// Browser globals
		factory();
	}
}(function (undefined) {
	'use strict';
	
	angular.module('CondoBroadcaster', []).factory('Condo.Broadcast', ['$rootScope', function($rootScope) {
		// eventBroadcaster is the object created by the factory method.
		var eventBroadcaster = {};
		
		// The message is a string or object to carry data with the event.
		eventBroadcaster.message = '';
		
		// The event name is a string used to define event types.
		eventBroadcaster.eventName = '';
		
		// This method is called from within a controller to define an event and attach data to the eventBroadcaster object.
		eventBroadcaster.broadcast = function(evName, msg) {
			this.message = msg;
			this.eventName = evName;
			this.broadcastItem();
		};
		
		// This method broadcasts an event with the specified name.
		eventBroadcaster.broadcastItem = function() {
			$rootScope.$broadcast(this.eventName);
		};

		return eventBroadcaster;
	}]);
	
}));
