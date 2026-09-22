-- Run once in the Supabase SQL Editor to support tracking whether emails have been sent to students.
ALTER TABLE public.students
ADD COLUMN IF NOT EXISTS email_sent BOOLEAN NOT NULL DEFAULT FALSE;
