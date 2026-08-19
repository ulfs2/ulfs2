const { Pool } = require('pg');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabaseUrl = process.env.SUPABASE_URL || 'https://tcwapqlphdxuqpgyrybq.supabase.co';
const supabaseKey = [
  process.env.SUPABASE_SECRET_KEY,
  process.env.SUPABASE_PUBLISHABLE_KEY,
  process.env.SUPABASE_ANON_KEY
].find(key => key && !key.includes('...') && key.length >= 40);
const supabaseRequested = Boolean(process.env.SUPABASE_URL);

// Create Supabase JS Client if credentials are fully configured
const supabase = (supabaseUrl && supabaseKey)
  ? createClient(supabaseUrl, supabaseKey)
  : null;

// PostgreSQL Pool connection (supports Supabase Postgres or local Postgres)
const connectionString = process.env.DATABASE_URL;

const poolConfig = connectionString
  ? {
      connectionString,
      ssl: connectionString.includes('supabase.co') || connectionString.includes('supabase.com')
        ? { rejectUnauthorized: false }
        : false,
    }
  : {
      user: process.env.PGUSER || process.env.USER || 'postgres',
      host: process.env.PGHOST || 'localhost',
      database: process.env.PGDATABASE || 'student_hub',
      password: process.env.PGPASSWORD || '',
      port: parseInt(process.env.PGPORT || '5432', 10),
    };

const pool = new Pool({
  ...poolConfig,
  connectionTimeoutMillis: 5000,
});

async function initDb() {
  const client = await pool.connect();
  try {
    // 1. Create system users table for login
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        username VARCHAR(100) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        full_name VARCHAR(150),
        role VARCHAR(50) DEFAULT 'admin',
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Seed default admin user if missing
    const userRes = await client.query(`SELECT COUNT(*) FROM users WHERE username = 'admin';`);
    if (parseInt(userRes.rows[0].count, 10) === 0) {
      await client.query(`
        INSERT INTO users (username, password, full_name, role)
        VALUES ('admin', 'admin123', 'Andrew Haddad', 'admin');
      `);
      console.log('Default admin user created (username: admin, password: admin123)');
    }

    // 2. Create students table with username & password fields
    await client.query(`
      CREATE TABLE IF NOT EXISTS students (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        first_name VARCHAR(100) NOT NULL,
        father_name VARCHAR(100) NOT NULL,
        family_name VARCHAR(100) NOT NULL,
        origin VARCHAR(100),
        address VARCHAR(255),
        school VARCHAR(150) NOT NULL,
        major VARCHAR(150) NOT NULL,
        political_affiliation VARCHAR(150),
        status VARCHAR(50) NOT NULL,
        language VARCHAR(50) NOT NULL,
        campus VARCHAR(50) NOT NULL,
        phone VARCHAR(50) NOT NULL,
        email VARCHAR(150) NOT NULL,
        in_group BOOLEAN NOT NULL DEFAULT FALSE,
        left_group BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);
    await client.query(`ALTER TABLE students ADD COLUMN IF NOT EXISTS in_group BOOLEAN NOT NULL DEFAULT FALSE;`);
    await client.query(`ALTER TABLE students ADD COLUMN IF NOT EXISTS left_group BOOLEAN NOT NULL DEFAULT FALSE;`);
    await client.query(`ALTER TABLE students ADD COLUMN IF NOT EXISTS political_affiliation VARCHAR(150);`);

    // Check if table is empty, insert sample records
    const res = await client.query('SELECT COUNT(*) FROM students;');
    if (parseInt(res.rows[0].count, 10) === 0) {
      console.log('Seeding initial student records into database...');
      const seedQuery = `
        INSERT INTO students (first_name, father_name, family_name, origin, address, school, major, status, language, campus, phone, email)
        VALUES 
        ('Carla', 'Joseph', 'Khoury', 'Batroun', 'Main Road, Batroun', 'Collège des Apôtres', 'Informatics', 'New', 'French', 'Fanar', '+961 03 123 456', 'carla.khoury@example.com'),
        ('Marc', 'Antoine', 'Sarkis', 'Byblos', 'Port Area, Jbeil', 'Champville', 'Mathematics', 'Mu3id', 'English', 'Amshit', '+961 70 987 654', 'marc.sarkis@example.com'),
        ('Yara', 'Elie', 'Haddad', 'Zahle', 'Boulevard, Zahle', 'Collège Sagesse', 'Physics', 'New', 'English', 'Fanar', '+961 71 456 789', 'yara.haddad@example.com');
      `;
      await client.query(seedQuery);
    }
  } finally {
    client.release();
  }
}

async function checkDbConnection() {
  try {
    if (supabase) {
      const { count, error } = await supabase.from('students').select('*', { count: 'exact', head: true });
      if (error) throw error;
      return {
        connected: true,
        provider: 'Supabase',
        database: 'Supabase students table',
        count: count || 0,
        message: 'Connected through the Supabase API'
      };
    }
    if (supabaseRequested) {
      return {
        connected: false,
        provider: 'Supabase',
        database: 'Supabase students table',
        count: 0,
        message: 'SUPABASE_SECRET_KEY or SUPABASE_PUBLISHABLE_KEY is missing or invalid'
      };
    }
    const client = await pool.connect();
    const res = await client.query('SELECT COUNT(*) FROM students;');
    client.release();
    const isSupabase = connectionString && (connectionString.includes('supabase.co') || connectionString.includes('supabase.com'));
    return {
      connected: true,
      provider: isSupabase ? 'Supabase PostgreSQL' : 'PostgreSQL',
      database: isSupabase ? 'Supabase (tcwapqlphdxuqpgyrybq)' : (poolConfig.database || 'PostgreSQL'),
      count: parseInt(res.rows[0].count, 10),
      message: isSupabase ? 'Connected to Supabase PostgreSQL Database' : 'PostgreSQL database connected'
    };
  } catch (err) {
    return {
      connected: false,
      provider: 'PostgreSQL / Supabase',
      database: 'PostgreSQL',
      count: 0,
      message: err.message
    };
  }
}

module.exports = {
  pool,
  supabase,
  supabaseRequested,
  initDb,
  checkDbConnection,
};
