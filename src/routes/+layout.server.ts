import type { LayoutServerLoad } from "./$types";

export const load: LayoutServerLoad = async ({ locals }) => {
  return {
    user: locals.user
      ? {
          id: locals.user.id,
          name: locals.user.name,
          email: locals.user.email,
          role: (locals.user as { role?: string }).role ?? "user",
        }
      : null,
  };
};
