const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

// Create a single supabase client for interacting with your database
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing Supabase credentials in .env file');
}

const supabase = createClient(supabaseUrl, supabaseKey);

const uploadFile = async (file, path) => {
  try {
    const { data, error } = await supabase.storage
      .from('chat-files')
      .upload(`${path}/${Date.now()}-${file.name}`, file.buffer, {
        contentType: file.mimetype,
        cacheControl: '3600'
      });

    if (error) throw error;
    
    // Get the public URL for the uploaded file
    const { data: { publicUrl } } = supabase.storage
      .from('chat-files')
      .getPublicUrl(data.path);
    
    return publicUrl;
  } catch (error) {
    console.error('Error uploading file:', error);
    throw error;
  }
};

module.exports = {
  supabase,
  uploadFile
};