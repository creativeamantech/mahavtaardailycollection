CREATE TABLE public.allowed_emails (
  email text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.allowed_emails TO service_role;
ALTER TABLE public.allowed_emails ENABLE ROW LEVEL SECURITY;

INSERT INTO public.allowed_emails (email) VALUES ('jain9640@gmail.com');

CREATE OR REPLACE FUNCTION public.enforce_allowed_email()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.allowed_emails WHERE lower(email) = lower(NEW.email)) THEN
    RAISE EXCEPTION 'This email is not allowed to sign in.';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER enforce_allowed_email_before_insert
BEFORE INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.enforce_allowed_email();