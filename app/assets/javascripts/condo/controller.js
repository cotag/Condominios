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
*		* http://ericterpstra.com/2012/09/angular-cats-part-3-communicating-with-broadcast/
*		* http://docs.angularjs.org/api/ng.$rootScope.Scope#$watch
*
**/

(function (factory) {
	if (typeof define === 'function' && define.amd) {
		// AMD
		define(['jquery', 'condo_uploader'], factory);
	} else {
		// Browser globals
		factory(jQuery, window.CondoUploader);
	}
}(function ($, uploads, undefined) {
	'use strict';
	


	//
	// Create a controller for managing the upload states
	//
	uploads.factory('Condo.Broadcast', ['$rootScope', function($rootScope) {
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
		
		
		
	}]).controller('UploadsCtrl', ['$scope', 'Condo.Api', 'Condo.Broadcast', function($scope, api, broadcaster) {
		
		$scope.uploads = [];
		$scope.endpoint = '/uploads';	// Default, the directive can overwrite this
		$scope.autostart = true;
		
		
		$scope.add = function(files) {
			var length = files.length,
				i = 0,
				ret = 0;		// We only want to check for auto-start after the files have been added
			
			for (; i < length; i += 1) {
				api.check_provider($scope.endpoint, files[i]).then(function(upload){
					ret += 1;
					$scope.uploads.push(upload);
					if(ret == length)
						$scope.check_autostart();
				}, function(failure) {
					
					ret += 1;
					if(ret == length)
						$scope.check_autostart();
						
					//
					// broadcast this so it can be handled by a directive
					//
					broadcaster.broadcast('coFileAddFailed', failure);
				});
			}
		};
		
		
		$scope.abort = function(upload) {
			upload.abort();
			$scope.check_autostart();
		};
		
		
		$scope.remove = function(upload) {
			//
			// Splice(upload, 1) was unreliable. This is better
			//
			for (var i = 0, length = $scope.uploads.length; i < length; i += 1) {
				if($scope.uploads[i] === upload) {
					$scope.uploads.splice(i, 1);
					break;
				}
			}
		};
		
		
		$scope.playpause = function(upload) {
			if (upload.state == 3)					// Uploading
				upload.pause();
			else
				upload.start();
		};
		
		
		//
		// Watch autostart and trigger a check when it is changed
		//
		$scope.$watch('autostart', function(newValue, oldValue) {
			if (newValue === true)
				$scope.check_autostart();
		});
		
		
		$scope.check_autostart = function() {
			//
			// Check if any uploads have been started already
			//	If there are no active uploads we'll auto-start
			//
			if ($scope.autostart) {
				var shouldStart = true,
					state, i, length;
					
				for (i = 0, length = $scope.uploads.length; i < length; i += 1) {
					state = $scope.uploads[i].state;
					if (state > 0 && state < 4) {
						shouldStart = false;
						break;
					}
				}
				
				if (shouldStart) {
					for (i = 0; i < length; i += 1) {
						if ($scope.uploads[i].state == 0) {
							$scope.uploads[i].start();
							break;
						}
					}
				}
			}
		};
		
	}]);
	
	
	
}));