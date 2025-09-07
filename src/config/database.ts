import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_ANON_KEY!;

export const supabase = createClient(supabaseUrl, supabaseKey);

// Test connection function
export async function testDatabaseConnection() {
  try {
    const { data, error } = await supabase.from('categories').select('count');
    if (error) throw error;
    console.log('Database connected successfully');
    return true;
  } catch (error) {
    console.error('Database connection failed:', error);
    return false;
  }
}