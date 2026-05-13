-- Align positions.closed with sharesight_holdings.closed for linked rows (BUG-01).
-- Satellite positions use sharesight_holding_key = holding_external_id.

update public.positions p
set closed = (h.closed is true)
from public.sharesight_holdings h
where p.user_id = h.user_id
  and p.sharesight_holding_key is not null
  and p.sharesight_holding_key = h.holding_external_id
  and (
    (p.kind = 'satellite' and h.portfolio_role = 'satellite')
    or (p.kind = 'core' and h.portfolio_role = 'core')
  );
