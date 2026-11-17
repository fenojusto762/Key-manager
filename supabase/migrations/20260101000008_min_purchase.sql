-- Compra mínima: 5 créditos (R$ 10,00), imposta também no banco
alter table public.payments drop constraint if exists payments_credits_range_check;
alter table public.payments add constraint payments_credits_range_check check (credits between 5 and 10000) not valid;
notify pgrst, 'reload schema';
