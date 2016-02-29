require 'condo'
require 'condo/strata/amazon_s3'

describe ::Condo do
    # Uses the example from the bottom of the page: http://s3.amazonaws.com/doc/s3-developer-guide/RESTAuthentication.html
    it "Should perform AmazonS3 request signing" do
        s3 = Condo::Strata::AmazonS3.new({
            :access_id => '44CF9590006BF252F707',
            :secret_key => 'OtxrzxIsfpFjA7SwPzILwy8Bw21TLhquhboDYROV'
        })
        
        result = s3.get_object({
            :bucket_name => 'quotes',
            :object_key => 'nelson',
            :object_options => {
                :expires => Time.at(1141889120)
            }
        })
        
        expect(result).to eq('https://s3.amazonaws.com/quotes/nelson?AWSAccessKeyId=44CF9590006BF252F707&Expires=1141889120&Signature=vjbyPxybdZaNmGa%2ByT272YEAiv4%3D')
    end
end
