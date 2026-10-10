-- RUN THIS FIRST, ON ITS OWN. Adds the new role to the user_role type.
alter type public.user_role add value if not exists 'messenger';
