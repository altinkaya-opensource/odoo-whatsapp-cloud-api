import { createContext, PropsWithChildren, useEffect, useState } from "react";
import { useAuth } from "../hooks/use-auth";

export type Profile = {
  id: string;
  name: string;
  blueTickEnabled: boolean;
  avatarUrl: string;
};

export const ProfileContext = createContext<
  | undefined
  | {
      profile: Profile;
      isLoading: boolean;
    }
>(undefined);

export default function ProfileProvider({ children }: PropsWithChildren) {
  const { user, backendUsers, backendUserId } = useAuth();
  const [profile, setProfile] = useState<{
    profile: Profile;
    isLoading: boolean;
  }>({
    profile: {
      id: "",
      name: "",
      blueTickEnabled: true,
      avatarUrl: "",
    },
    isLoading: false,
  });

  useEffect(() => {
    const backendUser = backendUsers.find((item) => item.id === backendUserId);

    setProfile({
      profile: {
        id: String(backendUser?.id ?? user?.uid ?? ""),
        name: backendUser?.name ?? (user as { name?: string })?.name ?? "User",
        blueTickEnabled: true,
        avatarUrl: backendUser?.imageUrl ?? "",
      },
      isLoading: false,
    });
  }, [backendUsers, backendUserId, user]);

  return (
    <ProfileContext.Provider value={{ ...profile }}>
      {children}
    </ProfileContext.Provider>
  );
}
