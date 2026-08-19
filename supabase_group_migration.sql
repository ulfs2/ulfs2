-- Run once in the Supabase SQL Editor for an existing Student Hub project.
ALTER TABLE public.students
ADD COLUMN IF NOT EXISTS in_group BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE public.students
ADD COLUMN IF NOT EXISTS left_group BOOLEAN NOT NULL DEFAULT FALSE;
