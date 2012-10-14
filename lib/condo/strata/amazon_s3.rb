module Condo; end
module Condo::Strata; end


class Condo::Strata::AmazonS3
	
	def initialize(options)
		@options = {
			:name => :AmazonS3,
			:location => :'us-east-1',
			:fog => {
				:provider => :AWS,
				:aws_access_key_id => options[:access_id],
				:aws_secret_access_key => options[:secret_key],
				:region => (options[:location] || 'us-east-1')
			}
		}.merge!(options)
		
		
		raise ArgumentError, 'Amazon Access ID missing' if @options[:access_id].nil?
		raise ArgumentError, 'Amazon Secret Key missing' if @options[:secret_key].nil?
		
		
		@options[:location] = @options[:location].to_sym
		@options[:region] = @options[:location] == :'us-east-1' ? 's3.amazonaws.com' : "s3-#{@options[:location]}.amazonaws.com"
	end
	
	
	def name
		@options[:name]
	end
	
	
	def location
		@options[:location]
	end
	
	
	
	#
	# Create a signed URL for accessing a private file
	#
	def get_object(options)
		options = {}.merge!(options)	# Need to deep copy here
		options[:object_options] = {
			:expires => 5.minutes.from_now,
			:date => Time.now,
			:verb => :get,		# Post for multi-part uploads http://docs.amazonwebservices.com/AmazonS3/latest/API/mpUploadInitiate.html
			:headers => {},
			:parameters => {},
			:protocol => :https
		}.merge!(options[:object_options] || {})
		options.merge!(@options)
		
		#
		# provide the signed request
		#
		sign_request(options)[:url]
	end
	
	
	#
	# Creates a new upload request (either single shot or multi-part)
	# => Passed: bucket_name, object_key, object_options, file_size
	#
	def new_upload(options)
		options = {}.merge!(options)	# Need to deep copy here
		options[:object_options] = {
			:permissions => :private,
			:expires => 5.minutes.from_now,
			:date => Time.now,
			:verb => :post,		# Post for multi-part uploads http://docs.amazonwebservices.com/AmazonS3/latest/API/mpUploadInitiate.html
			:headers => {},
			:parameters => {},
			:protocol => :https
		}.merge!(options[:object_options])
		options.merge!(@options)
		
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
		if options[:file_size] > 5.megabytes	# 5 mb (minimum chunk size)
			options[:object_options][:parameters][:uploads] = ''	# Customise the request to be a chunked upload
			options.delete(:file_id)								# Does not apply to chunked uploads
			
			request[:type] = :chunked_upload
		else
			if options[:file_id].present? && options[:object_options][:headers]['Content-Md5'].nil?
				#
				# The client side is sending hex formatted ids that will match the amazon etag
				# => We need this to be base64 for the md5 header (this is now done at the client side)
				#
				# options[:file_id] = [[options[:file_id]].pack("H*")].pack("m0")	# (the 0 avoids the call to strip - now done client side)
				# [ options[:file_id] ].pack('m').strip			# This wasn't correct
				# Base64.encode64(options[:file_id]).strip		# This also wasn't correct
				#
				options[:object_options][:headers]['Content-Md5'] = options[:file_id]
			end
			options[:object_options][:headers]['Content-Type'] = 'binary/octet-stream' if options[:object_options][:headers]['Content-Type'].nil?
			options[:object_options][:verb] = :put	# Put for direct uploads http://docs.amazonwebservices.com/AmazonS3/latest/API/RESTObjectPUT.html
			
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
		}.merge!(options[:object_options])
		options.merge!(@options)
		
		#
		# Set the upload 
		#
		options[:object_options][:parameters]['uploadId'] = options[:resumable_id]
		
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
		}.merge!(options[:object_options])
		options.merge!(@options)
		
		
		request = {}
		if options[:part] == 'finish'
			#
			# Send the commitment response
			#
			options[:object_options][:headers]['Content-Type'] = 'application/xml; charset=UTF-8' if options[:object_options][:headers]['Content-Type'].nil?
			options[:object_options][:verb] = :post
			request[:type] = :finish
		else
			#
			# Send the part upload request
			#
			options[:object_options][:headers]['Content-Md5'] = options[:file_id] if options[:file_id].present? && options[:object_options][:headers]['Content-Md5'].nil?
			options[:object_options][:headers]['Content-Type'] = 'binary/octet-stream' if options[:object_options][:headers]['Content-Type'].nil?
			options[:object_options][:parameters]['partNumber'] = options[:part]
			options[:object_options][:verb] = :put
			request[:type] = :part_upload
		end
		
		
		#
		# Set the upload 
		#
		options[:object_options][:parameters]['uploadId'] = options[:resumable_id]
		
		
		#
		# provide the signed request
		#
		request[:signature] = sign_request(options)
		request
	end
	
	
	def fog_connection
		@fog = @fog || Fog::Storage.new(@options[:fog])
		return @fog
	end
	
	
	def destroy(upload)
		connection = fog_connection
		directory = connection.directories.get(upload.bucket_name)	# it is assumed this exists - if not then the upload wouldn't have taken place
		file = directory.files.get(upload.object_key)
		
		if upload.resumable
			return file.destroy unless file.nil?
			begin
				if upload.resumable_id.present?
					connection.abort_multipart_upload(upload.bucket_name, upload.object_key, upload.resumable_id)
					return true
				end
			rescue
				# In-case resumable_id was invalid or did not match the object key
			end
			
			#
			# The user may have provided an invalid upload key, we'll need to search for the upload and destroy it
			#
			begin
				resp = connection.list_multipart_uploads(upload.bucket_name, {'prefix' => upload.object_key})
				resp.body['Upload'].each do |file|
					#
					# TODO:: BUGBUG:: there is an edge case where there may be more multi-part uploads with this this prefix then will be provided in a single request
					# => We'll need to handle this edge case to avoid abuse and dangling objects
					#
					connection.abort_multipart_upload(upload.bucket_name, upload.object_key, file['UploadId']) if file['Key'] == upload.object_key	# Ensure an exact match
				end
				return true	# The upload was either never initialised or has been destroyed
			rescue
				return false
			end
		else
			return true if file.nil?
			return file.destroy
		end
	end
	
	
	
	protected
	
	
	
	def sign_request(options)
		
		#
		# Build base URL
		#
		options[:object_options][:date] = options[:object_options][:date].utc.httpdate
		options[:object_options][:expires] = options[:object_options][:expires].utc.to_i
		url = "/#{options[:bucket_name]}/#{options[:object_key]}"
		
		#
		# Add request params
		#
		url << '?'
		options[:object_options][:parameters].each do |key, value|
			url += value.empty? ? "#{key}&" : "#{key}=#{value}&"
		end
		url.chop!
		
		#
		# Build a request signature
		#
		signature = "#{options[:object_options][:verb].to_s.upcase}\n#{options[:file_id]}\n#{options[:object_options][:headers]['Content-Type']}\n#{options[:object_options][:expires]}\n"
		options[:object_options][:headers].each do |key, value|
			signature << "#{key}:#{value}\n" if key =~ /x-amz-/
		end
		signature << url
		
		
		#
		# Encode the request signature
		#
		signature = CGI::escape(Base64.encode64(OpenSSL::HMAC.digest(OpenSSL::Digest::Digest.new('sha1'), @options[:secret_key], signature)).gsub("\n",""))
		
		
		#
		# Finish building the request
		#
		url += options[:object_options][:parameters].present? ? '&' : '?'
		return {
			:verb => options[:object_options][:verb].to_s.upcase,
			:url => "#{options[:object_options][:protocol]}://#{options[:region]}#{url}AWSAccessKeyId=#{@options[:access_id]}&Expires=#{options[:object_options][:expires]}&Signature=#{signature}",
			:headers => options[:object_options][:headers]
		}
	end
	
	
end

