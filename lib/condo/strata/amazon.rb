module Condo; end
module Condo::Strata; end


class Condo::Strata::AmazonS3
	
	
	LOCATIONS = {
		:US_Standard => 's3.amazonaws.com',
		
	}
	
	
	def initialize(options)
		@options = {
			:name => :AmazonS3,
			:location => :'us-east-1'
			
		}.merge(options)
		
		
		@options[:region]
	end
	
	
	#
	# Creates a new upload request (either single shot or multi-part)
	#
	def new_upload(options)
		
	end
	
	
	#
	# Returns the request to get the parts of a resumable upload
	#
	def get_parts(options)
		
	end
	
	
	#
	# Returns the requests for uploading parts and completing a resumable upload
	#
	def set_part(options)
		if options[:part]
	end
	
	
	
	protected
	
	
	
	
	
end

