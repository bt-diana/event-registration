import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  fetchMe,
  login,
  logout,
  signup,
  type LoginBody,
  type Me,
  type Role,
  type SignupBody,
} from "./api";

export const ME_KEY = ["me"] as const;

// One GET /auth/me per app start (W-A1). Login, sign-up and logout change it by hand.
export function useMe() {
  return useQuery({
    queryKey: ME_KEY,
    queryFn: fetchMe,
    staleTime: Infinity,
    retry: false,
    refetchOnWindowFocus: false,
  });
}

// The mutation variable is a function that reads the form at submit time, so the
// password never sits as data in the mutation cache (W-A20).
export type Read<T> = () => T;

export function useLogin(role: Role) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (read: Read<LoginBody>) => login(role, read()),
    onSuccess: (me: Me) => queryClient.setQueryData(ME_KEY, me),
  });
}

export function useSignup(role: Role) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (read: Read<SignupBody>) => signup(role, read()),
    onSuccess: (me: Me) => queryClient.setQueryData(ME_KEY, me),
  });
}

export function useLogout() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (role: Role) => logout(role),
    onSuccess: () => {
      queryClient.setQueryData(ME_KEY, null);
      queryClient.removeQueries({ predicate: (query) => query.queryKey[0] !== ME_KEY[0] });
    },
  });
}
