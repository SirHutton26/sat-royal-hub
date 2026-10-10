-- RUN THIS FIRST, ON ITS OWN. Adds the Headteacher and Store-keeper roles.
alter type public.user_role add value if not exists 'headteacher';
alter type public.user_role add value if not exists 'storekeeper';
