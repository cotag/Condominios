module Condo; end
module Condo::Strata; end


class Condo::Strata::AmazonS3
	
	def initialize(options)
		@options = {
			:name => :AmazonS3,
			:location => :'us-east-1'
		}.merge(options)
		
		
		raise ArgumentError, 'Amazon Access ID missing' if @options[:access_id].nil?
		raise ArgumentError, 'Amazon Secret Key missing' if @options[:secret_key].nil?
		
		
		@options[:location] = @options[:location].to_sym
		
		@options[:region] = case @options[:location]
		when :'us-east-1'
			's3.amazonaws.com'
		else
			"s3-#{@options[:location]}.amazonaws.com"
		end
	end
	
	
	def name
		@options[:name]
	end
	
	
	def location
		@options[:location]
	end
	
	
	#
	# Creates a new upload request (either single shot or multi-part)
	# => Passed: bucket_name, object_key, object_options, file_size
	#
	def new_upload(options)
		options[:object_options] = {
			:permissions => :private,
			:expires => 5.minutes.from_now,
			:date => Time.now,
			:verb => :post,
			:headers => {},
			:parameters => {},
			:protocol => :https
		}.merge(options[:object_options])
		options.merge(@options)
		
		#
		# Set the access control headers
		#
		if options[:object_options][:headers]['x-amz-acl'].nil?
			options[:object_options][:headers]['x-amz-acl'] = case options[:object_options][:permissions]
			when :public
				:'public-read'
			else
				:private
			end
		end
		
		#
		# Decide what type of request is being sent
		#
		request = {}
		if options[:file_size] > 6291456
			options[:object_options][:parameters][:uploads] = ''	# Customise the request to be a chunked upload
			options.delete(:file_id)							# Does not apply to chunked uploads
			
			request[:type] = :chunked_upload
		else
			options[:object_options][:headers]['Content-Type'] = 'binary/octet-stream' if options[:object_options][:headers]['Content-Type'].nil?
			
			request[:type] = :direct_upload
		end
		
		
		#
		# provide the signed request
		#
		request[:signature] = sign_request(options)
		request
	end
	
	
	#
	# Returns the request to get the parts of a resumable upload
	#
	def get_parts(options)
		options[:object_options] = {
			:expires => 5.minutes.from_now,
			:date => Time.now,
			:verb => :get,
			:headers => {},
			:parameters => {},
			:protocol => :https
		}.merge(options[:object_options])
		options.merge(@options)
		
		#
		# Set the upload 
		#
		if options[:object_options][:parameters]['uploadId'].nil?
			options[:object_options][:parameters]['uploadId'] = options[:resumable_id]
		end
		
		#
		# provide the signed request
		#
		{
			:type => :parts,
			:signature => sign_request(options)
		}
	end
	
	
	#
	# Returns the requests for uploading parts and completing a resumable upload
	#
	def set_part(options)
		options[:object_options] = {
			:expires => 5.minutes.from_now,
			:date => Time.now,
			:headers => {},
			:parameters => {},
			:protocol => :https
		}.merge(options[:object_options])
		options.merge(@options)
		
		
		#
		# Set the upload 
		#
		if options[:object_options][:parameters]['uploadId'].nil?
			options[:object_options][:parameters]['uploadId'] = options[:resumable_id]
		end
		
		request = {}
		if options[:part] == 'finish'
			#
			# Send the commitment response
			#
			options[:object_options][:verb] = :put
			request[:type] = :finish
		else
			#
			# Send the part upload request
			#
			if options[:object_options][:parameters]['partNumber'].nil?
				options[:object_options][:parameters]['partNumber'] = options[:part]
			end
			options[:object_options][:verb] = :post
			request[:type] = :part_upload
		end
		
		
		#
		# provide the signed request
		#
		request[:signature] = sign_request(options)
		request
	end
	
	
	
	protected
	
	
	
	def sign_request(options)
		
		#
		# Build base URL
		#
		options[:date] = options[:date].utc.httpdate
		options[:expires] = options[:expires].utc.to_i
		url = "#{options[:protocol]}://#{options[:region]}/#{options[:bucket_name]}/#{options[:object_key]}?"
		
		#
		# Add request params
		#
		options[:object_options][:parameters].each do |key, value|
			url += value.empty? ? "#{key}&" : "#{key}=#{value}&"
		end
		
		
		#
		# Build a request signature
		#
		signature = "#{options[:object_options][:verb].to_s.upcase}\n#{options[:file_id]}\n#{options[:object_options][:headers]['Content-Type']}\n#{options[:object_options][:expires]}\n"
		options[:object_options][:headers].each do |key, value|
			signature += "#{key}:#{value}\n" if key =~ /x-amz-/
		end
		signature += "#{url}"
		
		
		#
		# Encode the request signature
		#
		signature = CGI::escape(Base64.encode64(OpenSSL::HMAC.digest(OpenSSL::Digest::Digest.new('sha1'), options[:secret_key], signature)).gsub("\n",""))
		
		
		#
		# Finish building the request
		#
		return {
			:verb => options[:object_options][:verb].to_s.upcase,
			:url => "#{url}AWSAccessKeyId=#{options[:access_id]}&Expires=#{options[:object_options][:expires]}&Signature=#{signature}",
			:headers => options[:object_options][:headers]
		}
	end
	
	
end

