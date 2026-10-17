-- Homatch — Find Buyers notifications open THE search they are about.
--
-- WHAT WAS WRONG
--
-- The three Find Buyers notices (search started, first results, search
-- finished / needs review) all linked to /property/<id>/matches: the generic
-- dashboard for the property, not the search that produced the notice. A
-- customer with two searches tapped "search finished" and landed somewhere
-- that did not show that search. They already stored
-- entity_type='matching_jobs' and entity_id=<job id>, so the target was known
-- and simply not used.
--
-- The copy also said "matches" (KA "შესაბამისობა") for what are research
-- results: a lead of any strength counted as a "new match". The product word
-- for a match is დამთხვევა, and a count of results is honestly "new
-- results", whatever their strength.
--
-- WHAT THIS DOES
--
--   * find_buyers_notice_text: same signature, same keys; "matches" becomes
--     "results" in all six languages, bodies point at the search.
--   * matching_jobs_notify_finished / find_buyers_notify_first_result: the
--     link is /property/<id>/buyers/external?job=<job id>, and the row's
--     property_id is filled (the column exists; notify_emit does not take
--     it; its own sub-block, so a failure there can never undo the notice
--     itself). Recreated from their latest definitions in
--     20261016090000_find_buyers_lifecycle_truth.sql; SECURITY DEFINER and
--     search_path unchanged, triggers unchanged (only the functions change).
--
-- Rows already written keep their old link; the frontend maps
-- matching_jobs + /property/<id>/matches to the same destination.
-- Append-only; the runner owns the transaction.

create or replace function public.find_buyers_notice_text(p_lang text, p_key text, p_rent boolean, p_n integer default 0)
returns text[]
language sql
immutable
set search_path to ''
as $function$
  select case coalesce(nullif(lower(left(p_lang, 2)), ''), 'ka')
    when 'en' then case p_key
      when 'started' then array[case when p_rent then 'Tenant search started' else 'Buyer search started' end,
                                'We are looking for active public demand from the last 30 days. Results appear as they arrive.']
      when 'first' then array['First results found', 'The search is still running. Open the search to see them.']
      when 'done_results' then array['Search finished: ' || p_n || case when p_n = 1 then ' new result' else ' new results' end, 'Open the search to review them.']
      when 'done_zero' then array['Search finished: no new active demand found for now', 'Every source was searched; demand older than 30 days is not counted.']
      when 'failed' then array['The search could not finish', 'Open the search to see what happened; you can start again from there.']
      else array['The search could not start right now', 'Search sources are unavailable at the moment. Please try again later.'] end
    when 'ru' then case p_key
      when 'started' then array[case when p_rent then 'Поиск арендаторов начался' else 'Поиск покупателей начался' end,
                                'Ищем активный публичный спрос за последние 30 дней. Результаты появятся по мере поступления.']
      when 'first' then array['Первые результаты уже есть', 'Поиск продолжается. Откройте поиск, чтобы посмотреть.']
      when 'done_results' then array['Поиск завершён: новых результатов — ' || p_n, 'Откройте поиск, чтобы их просмотреть.']
      when 'done_zero' then array['Поиск завершён: нового активного спроса пока не найдено', 'Все источники проверены; спрос старше 30 дней не учитывается.']
      when 'failed' then array['Поиск не удалось завершить', 'Откройте поиск, чтобы узнать подробности и начать заново.']
      else array['Поиск сейчас не удалось начать', 'Источники поиска временно недоступны. Попробуйте позже.'] end
    when 'tr' then case p_key
      when 'started' then array[case when p_rent then 'Kiracı araması başladı' else 'Alıcı araması başladı' end,
                                'Son 30 günün aktif, herkese açık talebini arıyoruz. Sonuçlar geldikçe görünür.']
      when 'first' then array['İlk sonuçlar bulundu', 'Arama sürüyor. Görmek için aramayı açın.']
      when 'done_results' then array['Arama tamamlandı: ' || p_n || ' yeni sonuç', 'İncelemek için aramayı açın.']
      when 'done_zero' then array['Arama tamamlandı: şimdilik yeni aktif talep bulunamadı', 'Tüm kaynaklar tarandı; 30 günden eski talepler sayılmaz.']
      when 'failed' then array['Arama tamamlanamadı', 'Ne olduğunu görmek ve yeniden başlatmak için aramayı açın.']
      else array['Arama şu anda başlatılamadı', 'Arama kaynakları şu anda kullanılamıyor. Lütfen daha sonra tekrar deneyin.'] end
    when 'ar' then case p_key
      when 'started' then array[case when p_rent then 'بدأ البحث عن مستأجرين' else 'بدأ البحث عن مشترين' end,
                                'نبحث عن طلب عام نشط من آخر 30 يومًا. تظهر النتائج فور وصولها.']
      when 'first' then array['ظهرت أولى النتائج', 'البحث مستمر. افتح البحث لرؤيتها.']
      when 'done_results' then array['انتهى البحث: نتائج جديدة: ' || p_n, 'افتح البحث لمراجعتها.']
      when 'done_zero' then array['انتهى البحث: لم يُعثر على طلب نشط جديد حاليًا', 'تم البحث في جميع المصادر؛ لا يُحتسب الطلب الأقدم من 30 يومًا.']
      when 'failed' then array['تعذّر إكمال البحث', 'افتح البحث لمعرفة ما حدث والبدء من جديد.']
      else array['تعذّر بدء البحث الآن', 'مصادر البحث غير متاحة حاليًا. يرجى المحاولة لاحقًا.'] end
    when 'he' then case p_key
      when 'started' then array[case when p_rent then 'החיפוש אחר שוכרים התחיל' else 'החיפוש אחר קונים התחיל' end,
                                'אנחנו מחפשים ביקוש ציבורי פעיל מ־30 הימים האחרונים. התוצאות יופיעו כשיגיעו.']
      when 'first' then array['נמצאו תוצאות ראשונות', 'החיפוש עדיין פועל. פתחו את החיפוש כדי לראות אותן.']
      when 'done_results' then array['החיפוש הסתיים: תוצאות חדשות: ' || p_n, 'פתחו את החיפוש כדי לעיין בהן.']
      when 'done_zero' then array['החיפוש הסתיים: לא נמצא כרגע ביקוש פעיל חדש', 'כל המקורות נסרקו; ביקוש ישן מ־30 יום אינו נספר.']
      when 'failed' then array['לא ניתן היה להשלים את החיפוש', 'פתחו את החיפוש כדי לראות מה קרה ולהתחיל מחדש.']
      else array['לא ניתן היה להתחיל את החיפוש כעת', 'מקורות החיפוש אינם זמינים כרגע. נסו שוב מאוחר יותר.'] end
    else case p_key
      when 'started' then array[case when p_rent then 'მოიჯარეების ძებნა დაიწყო' else 'მყიდველების ძებნა დაიწყო' end,
                                'ვეძებთ ბოლო 30 დღის აქტიურ საჯარო მოთხოვნას. შედეგები გამოჩნდება, როგორც კი მოვა.']
      when 'first' then array['პირველი შედეგები უკვე გვაქვს', 'ძებნა გრძელდება — გახსენით ძებნა მათ სანახავად.']
      when 'done_results' then array['ძებნა დასრულდა — ახალი შედეგები: ' || p_n, 'გახსენით ძებნა მათ სანახავად.']
      when 'done_zero' then array['ძებნა დასრულდა — ამ ეტაპზე ახალი აქტიური მოთხოვნა ვერ მოიძებნა', 'ყველა წყარო დამუშავდა; 30 დღეზე ძველი მოთხოვნა არ ითვლება.']
      when 'failed' then array['ძებნა ვერ დასრულდა', 'გახსენით ძებნა, რომ ნახოთ რა მოხდა — იქიდან ძებნის თავიდან დაწყებაც შეგიძლიათ.']
      else array['ძებნა ამ ეტაპზე ვერ დაიწყო', 'საძიებო წყაროები ამჟამად მიუწვდომელია. სცადეთ მოგვიანებით.'] end
  end;
$function$;
revoke all on function public.find_buyers_notice_text(text, text, boolean, integer) from public, anon, authenticated;

create or replace function public.matching_jobs_notify_finished()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_lang text;
  v_rent boolean;
  v_state jsonb;
  v_new int;
  v_key text;
  v_txt text[];
  v_notice uuid;
  /* THIS search, not the property's dashboard. */
  v_link text := '/property/' || new.property_id::text || '/buyers/external?job=' || new.id::text;
begin
  if new.status::text = old.status::text or new.user_id is null then return new; end if;
  begin
    select preferred_language into v_lang from public.users where id = new.user_id;
    select upper(coalesce(transaction_type::text, 'SALE')) = 'RENT' into v_rent from public.properties where id = new.property_id;

    /* STARTED: the first move into searching (a resume is not a new start). */
    if new.status::text = 'searching_sources' and old.status::text <> 'paused' then
      v_txt := public.find_buyers_notice_text(v_lang, 'started', coalesce(v_rent, false));
      v_notice := public.notify_emit(new.user_id, 'MATCHING_STARTED'::public.notification_type, v_txt[1], v_txt[2],
        'NORMAL', v_link, 'matching_jobs', new.id, 'matching-job-started:' || new.id::text);
      if v_notice is not null and new.property_id is not null then
        begin
          update public.notifications set property_id = new.property_id where id = v_notice and property_id is null;
        exception when others then
          raise warning 'matching_jobs_notify_finished property_id: %', sqlerrm;
        end;
      end if;
      return new;
    end if;

    if new.status::text not in ('completed', 'partially_completed', 'budget_reached', 'failed') then return new; end if;
    v_state := public.find_buyers_job_state(new.id);
    v_new := greatest(coalesce((v_state ->> 'newResults')::int, 0), coalesce(new.fresh_matches_created, 0));
    v_key := case v_state ->> 'state'
      when 'COMPLETED_WITH_RESULTS' then 'done_results'
      when 'COMPLETED_NO_RESULTS' then 'done_zero'
      when 'DEGRADED_COMPLETED' then 'done_zero'
      when 'UNAVAILABLE' then 'unavailable'
      else case when new.status::text = 'failed' then 'failed' when v_new > 0 then 'done_results' else 'unavailable' end end;
    v_txt := public.find_buyers_notice_text(v_lang, v_key, coalesce(v_rent, false), v_new);
    v_notice := public.notify_emit(new.user_id,
      (case when v_key in ('done_results', 'done_zero') then 'CAMPAIGN_COMPLETED' else 'CAMPAIGN_NEEDS_REVIEW' end)::public.notification_type,
      v_txt[1], v_txt[2], 'NORMAL', v_link, 'matching_jobs', new.id, 'matching-job-finished:' || new.id::text);
    if v_notice is not null and new.property_id is not null then
      begin
        update public.notifications set property_id = new.property_id where id = v_notice and property_id is null;
      exception when others then
        raise warning 'matching_jobs_notify_finished property_id: %', sqlerrm;
      end;
    end if;
  exception when others then
    /* A notification must never fail the job's own state change. */
    raise warning 'matching_jobs_notify_finished: %', sqlerrm;
  end;
  return new;
end $function$;
revoke all on function public.matching_jobs_notify_finished() from public, anon, authenticated;

/* FIRST RESULTS: the first qualified lead of a campaign that is still running. */
create or replace function public.find_buyers_notify_first_result()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_job public.matching_jobs%rowtype;
  v_lang text;
  v_txt text[];
  v_notice uuid;
begin
  begin
    select * into v_job from public.matching_jobs where id = new.matching_job_id;
    if not found or v_job.status::text not in ('searching_sources', 'paused', 'classifying', 'ranking') then return new; end if;
    select preferred_language into v_lang from public.users where id = v_job.user_id;
    v_txt := public.find_buyers_notice_text(v_lang, 'first', false);
    v_notice := public.notify_emit(v_job.user_id, 'MATCH_FOUND'::public.notification_type, v_txt[1], v_txt[2],
      'NORMAL', '/property/' || v_job.property_id::text || '/buyers/external?job=' || v_job.id::text,
      'matching_jobs', v_job.id, 'find-buyers-first-result:' || v_job.id::text);
    if v_notice is not null and v_job.property_id is not null then
      begin
        update public.notifications set property_id = v_job.property_id where id = v_notice and property_id is null;
      exception when others then
        raise warning 'find_buyers_notify_first_result property_id: %', sqlerrm;
      end;
    end if;
  exception when others then
    raise warning 'find_buyers_notify_first_result: %', sqlerrm;
  end;
  return new;
end $function$;
revoke all on function public.find_buyers_notify_first_result() from public, anon, authenticated;
