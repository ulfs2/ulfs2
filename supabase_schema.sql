-- Supabase Database Migration Script for Student Hub

-- 1. Create system users table for login authentication
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username VARCHAR(100) UNIQUE NOT NULL,
  password VARCHAR(255) NOT NULL,
  full_name VARCHAR(150),
  role VARCHAR(50) DEFAULT 'admin',
  approved BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
ALTER TABLE users ADD COLUMN IF NOT EXISTS approved BOOLEAN NOT NULL DEFAULT TRUE;

-- Seed default admin user (username: admin, password: admin123)
INSERT INTO users (username, password, full_name, role)
VALUES ('andrew', 'andrew123', 'Andrew Haddad', 'admin')
ON CONFLICT (username) DO NOTHING;

-- 2. Create students table with username & password credentials
CREATE TABLE IF NOT EXISTS students (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  first_name VARCHAR(100) NOT NULL,
  father_name VARCHAR(100) NOT NULL,
  family_name VARCHAR(100) NOT NULL,
  username VARCHAR(100),
  password VARCHAR(255),
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

-- Safe migration for projects where the students table already exists
ALTER TABLE students ADD COLUMN IF NOT EXISTS in_group BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE students ADD COLUMN IF NOT EXISTS left_group BOOLEAN NOT NULL DEFAULT FALSE;

-- Seed initial sample students
INSERT INTO students (first_name, father_name, family_name, username, password, origin, address, school, major, status, language, campus, phone, email)
VALUES 
('Carla', 'Joseph', 'Khoury', 'carla_k', 'pass123', 'Batroun', 'Main Road, Batroun', 'Collège des Apôtres', 'Computer Science', 'New', 'French', 'Fanar', '+961 03 123 456', 'carla.khoury@example.com'),
('Marc', 'Antoine', 'Sarkis', 'marc_s', 'pass123', 'Byblos', 'Port Area, Jbeil', 'Champville', 'Business Administration', 'Mu3id', 'English', 'Amshit', '+961 70 987 654', 'marc.sarkis@example.com'),
('Yara', 'Elie', 'Haddad', 'yara_h', 'pass123', 'Zahle', 'Boulevard, Zahle', 'Collège Sagesse', 'Graphic Design', 'New', 'English', 'Fanar', '+961 71 456 789', 'yara.haddad@example.com');
