create table if not exists public.business_articles (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  content text not null,
  image_url text,
  publication_status text not null default 'draft',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.business_articles
  add column if not exists publication_status text not null default 'draft',
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

alter table public.business_articles enable row level security;

drop policy if exists "Public can read published business articles"
  on public.business_articles;

create policy "Public can read published business articles"
  on public.business_articles
  for select
  to anon, authenticated
  using (publication_status = 'published');

grant select on public.business_articles to anon, authenticated;
