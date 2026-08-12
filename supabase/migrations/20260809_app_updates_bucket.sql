-- Bucket para actualizaciones parciales de la app distribuidas fuera de Google Play.
-- Uso esperado:
-- 1) subir stable/update-manifest.json
-- 2) subir assets ligeros y APK estable al bucket app-updates

insert into storage.buckets (id, name, public)
select 'app-updates', 'app-updates', true
where not exists (
  select 1 from storage.buckets where id = 'app-updates'
);
