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
*		* 
*
**/


(function(angular, undefined) {
	'use strict';
	
	angular.module('Condo').

	factory('Condo.Broadcast', ['$channel', function($channel) {
			return $channel.openChannel('once unique');
	}]);
	
})(angular);
