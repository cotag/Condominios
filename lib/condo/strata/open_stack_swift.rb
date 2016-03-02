# encoding: utf-8

module Condo; end
module Condo::Strata; end

#
# NOTE:: Set Account Metadata Key for Public Access before this will work - X-Account-Meta-Temp-Url-Key: <your key>
#

class Condo::Strata::OpenStackSwift
    MIN_CHUNK_SIZE = 2.megabytes

    def initialize(options)
        @options = {
            :name => :OpenStackSwift,
            :location => :dfw,            # dallas or chicago    - this is set at bucket creation time
            :fog => {
                :provider => 'Rackspace',
                :rackspace_username => options[:username],
                :rackspace_api_key => options[:secret_key],
                :rackspace_cdn_url => options[:rackspace_cdn_url],
                :rackspace_temp_url_key => options[:temp_url_key],
                :rackspace_auth_url => options[:auth_url] || 'https://identity.api.rackspacecloud.com/v2.0' # is US and UK is 'lon.auth.api.rackspacecloud.com'
            }
        }.merge!(options)

        case @options[:location]
            when :dfw, :dallas, :DFW
                @options[:location] = 'storage101.dfw1.clouddrive.com'
                @options[:fog][:rackspace_region] = :dfw
            when :ord, :chicago, :ORD
                @options[:location] = 'storage101.ord1.clouddrive.com'
                @options[:fog][:rackspace_region] = :ord
            else @options[:location]
        end


        #raise ArgumentError, 'Rackspace Username missing' if @options[:username].nil?
        #raise ArgumentError, 'Rackspace Secret Key missing' if @options[:secret_key].nil?

        raise ArgumentError, 'Swift Storage URL missing' if @options[:storage_url].nil?
        raise ArgumentError, 'Swift Temp URL Key missing' if @options[:temp_url_key].nil?


        @options[:location] = @options[:location].to_sym
    end


    def name
        @options[:name]
    end


    def location
        @options[:location]
    end


    # Here for convenience 
    def set_metadata_key(key)
        fog_connection.request(
            :expects  => [201, 202, 204],
            :method   => 'POST',
            :headers  => {'X-Account-Meta-Temp-Url-Key' => key}
        )
    end


    def allow_cors(domains = 'http://localhost:3000', options_age = 10, headers = 'etag, x-object-manifest, content-type, accept, origin, x-requested-with')
        fog_connection.request(
            :expects  => [201, 202, 204],
            :method   => 'POST',
            :headers  => {
                'X-Container-Meta-Access-Control-Allow-Origin' => domains,
                'X-Container-Meta-Access-Control-Max-Age' => options_age,
                'X-Container-Meta-Access-Control-Allow-Headers' => headers
            }
        )
    end


    # Create a signed URL for accessing a private file
    def get_object(options)
        options = {}.merge!(options)    # Need to deep copy here
        options[:object_options] = {
            :expires => 5.minutes.from_now,
            :verb => :get,
            :headers => {},
            :parameters => {}
        }.merge!(options[:object_options] || {})
        options.merge!(@options)

        # provide the signed request
        sign_request(options)[:url]
    end


    # Creates a new upload request (either single shot or multi-part)
    # => Passed: bucket_name, object_key, object_options, file_size
    def new_upload(options)
        options = {}.merge!(options)    # Need to deep copy here
        options[:object_options] = {
            :expires => 5.minutes.from_now,
            :verb => :put,
            :headers => {},
            :parameters => {}
        }.merge!(options[:object_options])
        options.merge!(@options)

        options[:object_options][:headers]['ETag'] = options[:file_id] if options[:file_id].present? && options[:object_options][:headers]['ETag'].nil?
        options[:object_options][:headers]['Content-Type'] = 'binary/octet-stream' if options[:object_options][:headers]['Content-Type'].nil?


        # Decide what type of request is being sent
        request = {}
        # 2 mb (minimum chunk size)
        if options[:file_size] > MIN_CHUNK_SIZE

            options[:object_key] = options[:object_key] + gen_part_ext(options[:file_size], 1)        # Append the part number
            request[:type] = :chunked_upload
        else

            request[:type] = :direct_upload
        end

        # provide the signed request
        request[:signature] = sign_request(options)
        request
    end


    # Returns the part we are up to
    def get_parts(options)
        {
            :type => :parts,
            # NOTE:: This is legacy V1 - before parallel uploads
            :current_part => options[:resumable_id]
        }
    end


    # Returns the requests for uploading parts and completing a resumable upload
    def set_part(options)
        options[:object_options] = {
            :expires => 5.minutes.from_now,
            :headers => {},
            :parameters => {},
            :verb => :put
        }.merge!(options[:object_options])
        options.merge!(@options)


        request = {}
        if options[:part] == 'finish'
=begin
Dynamic large object now have to be created on the server...
This is how that was done. We now use Static Large Objects that can be created client side

            key = CGI::escape options[:object_key]

            # Send the commitment request
            fog_connection.request(
                :expects  => [200, 201],
                :method   => 'PUT',
                :headers  => {
                    'X-Object-Manifest' => "#{CGI::escape options[:bucket_name]}/#{key}/p"
                },
                path: "#{CGI::escape options[:bucket_name]}/#{key}"
            )

            return {}
=end

            options[:object_options][:headers]['ETag'] = options[:file_id] if options[:file_id].present?
            options[:object_options][:headers]['Content-Type'] = 'application/json'
            options[:object_key] = CGI::escape(options[:object_key])
            request[:signature] = sign_request(options, '&multipart-manifest=put')
        else
            # Send the part upload request
            options[:object_options][:headers]['ETag'] = options[:file_id] if options[:file_id].present? && options[:object_options][:headers]['ETag'].nil?
            options[:object_options][:headers]['Content-Type'] = 'binary/octet-stream'
            object_key = CGI::escape(options[:object_key]) + gen_part_ext(options[:file_size], options[:part])
            options[:object_key] = object_key
            request[:type] = :part_upload

            # Required for static large objects
            request[:path] = "#{CGI::escape options[:bucket_name]}/#{object_key}"
            request[:signature] = sign_request(options)
        end

        # provide the signed request
        request
    end


    def fog_connection
        @fog = @fog || Fog::Storage.new(@options[:fog])
        return @fog
    end


    def destroy(upload)
        connection = fog_connection
        directory = connection.directories.get(upload.bucket_name)    # it is assumed this exists - if not then the upload wouldn't have taken place

        if upload.resumable
            directory.files.all({'prefix' => upload.object_key}).each do |file|
                return false unless file.destroy
            end
        end

        file = directory.files.get(upload.object_key)    # this is the manifest when resumable

        return true if file.nil?
        return file.destroy
    end



    protected



    def sign_request(options, param = nil)
        # Build base URL
        options[:object_options][:expires] = options[:object_options][:expires].utc.to_i
        url = "/v1/#{options[:storage_url]}/#{CGI::escape options[:bucket_name]}/#{options[:object_key]}"

        # Build a request signature
        signature = "#{options[:object_options][:verb].to_s.upcase}\n#{options[:object_options][:expires]}\n#{url}"

        # Encode the request signature
        signature = OpenSSL::HMAC.hexdigest('sha1', @options[:temp_url_key], signature)

        # Finish building the request
        return {
            :verb => options[:object_options][:verb].to_s.upcase,
            :url => "#{options[:http_only] ? 'http' : 'https'}://#{@options[:location]}#{url}?temp_url_sig=#{signature}&temp_url_expires=#{options[:object_options][:expires]}#{param}",
            :headers => options[:object_options][:headers]
        }
    end


    def gen_part_ext(fileSize, partNumber)
        rval = (fileSize.to_f / MIN_CHUNK_SIZE).ceil.to_s.length
        partPad = partNumber.to_s.rjust(rval, '0')
        "/p#{partPad}"
    end
end

