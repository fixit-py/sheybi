"use client"

import * as React from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { useAuth, useUser } from "@clerk/nextjs"
import {
  Sidebar,
  SidebarContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"
import {
  HomeIcon,
  TrendingUpIcon,
  WalletIcon,
  Settings2Icon,
  CircleHelpIcon,
  FlameIcon,
  BadgeCheckIcon,
} from "lucide-react"

type ProfileResponse = {
  wallet_balance?: number;
  currency?: string;
  display_name?: string | null;
  handle?: string | null;
};

async function readJson(res: Response) {
  const text = await res.text();
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return { error: "invalid_json", raw: text };
  }
}

export function AppSidebar(props: React.ComponentProps<typeof Sidebar>) {
  const pathname = usePathname()
  const { getToken } = useAuth()
  const { user, isLoaded } = useUser()
  const [profile, setProfile] = React.useState<ProfileResponse | null>(null)

  React.useEffect(() => {
    if (!isLoaded || !user) return
    let active = true

    const loadProfile = async () => {
      try {
        const token = await getToken()
        const res = await fetch("/api/flask/me", {
          cache: "no-store",
          headers: {
            Authorization: token ? `Bearer ${token}` : "",
          },
        })
        const json = (await readJson(res)) as ProfileResponse
        if (!res.ok || !active) return
        setProfile(json)
      } catch {
        if (!active) return
        setProfile(null)
      }
    }

    void loadProfile()
    const timer = window.setInterval(() => {
      void loadProfile()
    }, 30000)
    return () => {
      active = false
      window.clearInterval(timer)
    }
  }, [getToken, isLoaded, user])

  // Format Clerk user for the NavUser footer
  const userData = React.useMemo(() => {
    if (!isLoaded || !user) {
      return {
        name: "Loading...",
        email: "please wait",
        avatar: "",
        handle: "",
        wallet: "Wallet",
      }
    }
    const walletBalance = Number(profile?.wallet_balance ?? 0)
    return {
      name: profile?.display_name || user.fullName || user.firstName || "User",
      handle: profile?.handle || "",
      email: user.primaryEmailAddress?.emailAddress || "",
      avatar: user.imageUrl,
      wallet: Number.isFinite(walletBalance)
        ? new Intl.NumberFormat("en-NG", {
            style: "currency",
            currency: profile?.currency || "NGN",
            maximumFractionDigits: 2,
          }).format(walletBalance)
        : "Wallet",
    }
  }, [profile, user, isLoaded])

  // Navigation items matching the desktop layout mockup
  const navigationItems = [
    {
      title: "Home",
      url: "/",
      icon: HomeIcon,
    },
    {
      title: "Portfolio",
      url: "/user/portfolio",
      icon: TrendingUpIcon,
    },
    {
      title: "History",
      url: "/user/history",
      icon: CircleHelpIcon,
    },
    {
      title: "Wallet",
      url: "/user/wallet",
      icon: WalletIcon,
    },
    {
      title: "Deposit",
      url: "/user/deposit",
      icon: WalletIcon,
    },
    {
      title: "Verification",
      url: "/user/verification",
      icon: BadgeCheckIcon,
    },
    {
      title: "Settings",
      url: "/user/settings",
      icon: Settings2Icon,
    },
  ]

  return (
    <Sidebar collapsible="offcanvas" {...props}>
      <SidebarHeader className=" border-b border-zinc-200/50 p-4 dark:border-zinc-800/50">
        <div className="flex flex-col gap-3">
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton
                size="lg"
                className="hover:bg-transparent active:bg-transparent"
                render={<Link href="/" />}
              >
                <div className="flex items-center gap-3">
                  <div className="flex size-9 items-center justify-center rounded-xl bg-[#4F46E5] text-white shadow-sm">
                    <FlameIcon className="size-5 fill-white" />
                  </div>
                  <div className="flex flex-col">
                    <span className="text-base font-bold tracking-tight text-zinc-950 dark:text-zinc-50">Sheybi</span>
                    <span className="text-xs text-zinc-500 font-medium">Prediction Market</span>
                  </div>
                </div>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>

          <Link
            href="/user/wallet"
            className="flex items-center justify-between rounded-2xl border border-zinc-200/70 bg-zinc-50 px-4 py-3 text-left transition-colors hover:bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-950 dark:hover:bg-zinc-900"
          >
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold text-zinc-900 dark:text-zinc-50">
                {userData.handle ? `@${userData.handle}` : userData.name}
              </div>
              <div className="truncate text-xs text-zinc-500 dark:text-zinc-400">
                Wallet
              </div>
            </div>
            <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
              {userData.wallet}
            </div>
          </Link>
        </div>
      </SidebarHeader>

      <SidebarContent className="px-3 py-4 gap-4">
        {/* Navigation list */}
        <SidebarMenu className="gap-1">
          {navigationItems.map((item) => {
            // Check if the current pathname matches the item's URL
            const isActive = pathname === item.url || (item.url !== "/user" && pathname?.startsWith(item.url))

            return (
              <SidebarMenuItem key={item.title}>
                <SidebarMenuButton
                  render={<Link href={item.url} />}
                  tooltip={item.title}
                  className={`flex items-center gap-3 px-3 py-2.5 h-11 rounded-xl transition-all duration-200 font-medium ${isActive
                    ? "bg-[#4F46E5] text-white hover:bg-[#4338CA] hover:text-white"
                    : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-900 dark:hover:text-zinc-50"
                    }`}
                >
                  <item.icon className={`size-5 shrink-0 ${isActive ? "text-white" : "text-zinc-500"}`} />
                  <span>{item.title}</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            )
          })}
        </SidebarMenu>
      </SidebarContent>

    </Sidebar>
  )
}
