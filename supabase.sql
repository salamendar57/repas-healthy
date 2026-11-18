-- Repas Healthy : base de données du foyer partagé.
-- À coller dans Supabase > SQL Editor > New query, puis "Run". Peut être relancé sans risque.

create table if not exists public.households (
  code text primary key check (char_length(code) >= 16),
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- Aucun accès direct à la table : uniquement via les fonctions ci-dessous,
-- qui exigent de connaître le code du foyer (16 caractères aléatoires).
alter table public.households enable row level security;
revoke all on public.households from anon, authenticated;

-- Lire les données d'un foyer
create or replace function public.hh_get(p_code text)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select data from households where code = p_code;
$$;

-- Créer un foyer (ne fait rien s'il existe déjà)
create or replace function public.hh_create(p_code text, p_data jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if char_length(p_code) < 16 then
    raise exception 'code trop court';
  end if;
  insert into households (code, data)
  values (p_code, coalesce(p_data, '{}'::jsonb))
  on conflict (code) do nothing;
  return (select data from households where code = p_code);
end;
$$;

-- Modifier une partie des données (ex : ['checked', 'Courgette|'] = true)
create or replace function public.hh_set(p_code text, p_path text[], p_value jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update households
     set data = jsonb_set(data, p_path, coalesce(p_value, 'null'::jsonb), true),
         updated_at = now()
   where code = p_code;
  if not found then
    raise exception 'foyer introuvable';
  end if;
end;
$$;

grant execute on function public.hh_get(text) to anon, authenticated;
grant execute on function public.hh_create(text, jsonb) to anon, authenticated;
grant execute on function public.hh_set(text, text[], jsonb) to anon, authenticated;
