module Condo; end
module Condo::Strata; end


class Fog::Storage::Google::Real
	def condo_request(*args)
		request(*args)
	end
end


class Condo::Strata::GoogleCloudStorage
	
	def initialize(options)
		@options = {
			:name => :GoogleCloudStorage,
			:location => :na,				# US or Europe, set at bucket creation time
			:fog => {
				:provider => 'Google',
				:google_storage_access_key_id => options[:access_id],
				:google_storage_secret_access_key => options[:secret_key]
			}
		}.merge!(options)
		
		
		raise ArgumentError, 'Google Access ID missing' if @options[:access_id].nil?
		raise ArgumentError, 'Google Secret Key missing' if @options[:secret_key].nil?
		
		
		@options[:location] = @options[:location].to_sym
	end
	
	
	#
	# Enable CORS on a bucket for a domain
	#
	def enable_cors(bucket, origin = '*')
		data =
<<-DATA
<?xml version="1.0" encoding="UTF-8"?>
<CorsConfig>
  <Cors>
    <Origins>
      <Origin>#{origin}</Origin>
    </Origins>
    <Methods>
      <Method>GET</Method>
      <Method>HEAD</Method>
      <Method>POST</Method>
      <Method>PUT</Method>
    </Methods>
    <ResponseHeaders>
      <ResponseHeader>origin</ResponseHeader>
      <ResponseHeader>content-md5</ResponseHeader>
      <ResponseHeader>authorization</ResponseHeader>
      <ResponseHeader>x-goog-date</ResponseHeader>
      <ResponseHeader>x-goog-acl</ResponseHeader>
      <ResponseHeader>content-type</ResponseHeader>
      <ResponseHeader>accept</ResponseHeader>
      <ResponseHeader>x-goog-api-version</ResponseHeader>
    </ResponseHeaders>
    <MaxAgeSec>1800</MaxAgeSec>
  </Cors>
</CorsConfig>
DATA
		
		fog_connection.condo_request(
			:expects  => 200,
			:body     => data,
			:method   => 'PUT',
			:headers  => {},
			:host       => "#{bucket}.storage.googleapis.com",
			:idempotent => true,
			:path     => '?cors'	# There is an issue with Fog where this isn't included as a canonical_resource
		)
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
			:verb => :get,		# Post for multi-part uploads http://docs.amazonwebservices.com/AmazonS3/latest/API/mpUploadInitiate.html
			:headers => {},
			:parameters => {}
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
			:verb => :put,				# This will be a post for resumable uploads
			:headers => {},
			:parameters => {},
			:protocol => :https
		}.merge!(options[:object_options])
		options.merge!(@options)
		
		
		#
		# Set the access control headers
		#
		options[:object_options][:headers]['x-goog-api-version'] = 2
		
		if options[:object_options][:headers]['x-goog-acl'].nil?
			options[:object_options][:headers]['x-goog-acl'] = case options[:object_options][:permissions]
			when :public
				:'public-read'
			else
				:private
			end
		end
		
		options[:object_options][:headers]['Content-Md5'] = options[:file_id] if options[:file_id].present? && options[:object_options][:headers]['Content-Md5'].nil?
		options[:object_options][:headers]['Content-Type'] = 'binary/octet-stream' if options[:object_options][:headers]['Content-Type'].nil?
				
		
		#
		# Decide what type of request is being sent
		# => Currently google only supports direct uploads (no CORS resumables yet!)
		#
		{
			:signature => sign_request(options),
			:type => :direct_upload
		}
	end
	
	
	#
	# Creates a request for the byte we were up to
	# => doesn't work with CORS yet
	#
	def get_parts(options)
		{
			:type => :parts
		}
	end
	
	
	#
	# Returns the requests for uploading parts and completing a resumable upload
	#
	def set_part(options)
		{
			:type => :part_upload
		}
	end
	
	
	def fog_connection
		@fog = @fog || Fog::Storage.new(@options[:fog])
		return @fog
	end
	
	
	def destroy(upload)
		connection = fog_connection
		directory = connection.directories.get(upload.bucket_name)	# it is assumed this exists - if not then the upload wouldn't have taken place		
		file = directory.files.get(upload.object_key)	# this is the manifest when resumable
		
		return true if file.nil?
		return file.destroy
	end
	
	
	
	protected
	
	
	
	def sign_request(options)
		
		#
		# Build base URL
		#
		verb = options[:object_options][:verb].to_s.upcase.to_sym
		options[:object_options][:expires] = options[:object_options][:expires].utc.to_i
		
		url = "/#{options[:object_key]}"
		
		
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
		signature = "#{verb}\n#{options[:file_id]}\n#{options[:object_options][:headers]['Content-Type']}\n#{options[:object_options][:expires]}\n"
		if verb != :GET
			options[:object_options][:headers]['x-goog-date'] = Time.now.utc.httpdate
		
			google_headers, canonical_google_headers = {}, ''			# Copied from https://github.com/fog/fog/blob/master/lib/fog/google/storage.rb
			for key, value in options[:object_options][:headers]
				if key[0..6] == 'x-goog-'
					google_headers[key] = value
				end
			end
			
			google_headers = google_headers.sort {|x, y| x[0] <=> y[0]}
			for key, value in google_headers
				signature << "#{key}:#{value}\n"
			end
		end
		
		signature << "/#{options[:bucket_name]}#{url}"
		
		
		#
		# Encode the request signature
		#
		signature = Base64.encode64(OpenSSL::HMAC.digest(OpenSSL::Digest::Digest.new('sha1'), @options[:secret_key], signature)).chomp!
		
		url += options[:object_options][:parameters].present? ? '&' : '?'
		url = "#{options[:object_options][:protocol]}://#{options[:bucket_name]}.storage.googleapis.com#{url}GoogleAccessId=#{@options[:access_id]}&Expires=#{options[:object_options][:expires]}&Signature=#{CGI::escape(signature)}"
		options[:object_options][:headers]['Authorization'] = "GOOG1 #{@options[:access_id]}:#{signature}"
		
		
		#
		# Finish building the request
		#
		return {
			:verb => options[:object_options][:verb].to_s.upcase,
			:url => url,
			:headers => options[:object_options][:headers]
		}
	end
	
	
end

