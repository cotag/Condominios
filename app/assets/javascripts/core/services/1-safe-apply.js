
(function(angular, undefined) {
	'use strict';

	angular.module('Core').
		service('$safeApply', function() {
			this.do = function(scope, fn) {
				var phase = scope.$root.$$phase;
				if(phase == '$apply' || phase == '$digest') {
					fn();
				} else {
					scope.$apply(fn);
				}
			};
		});

})(angular);
