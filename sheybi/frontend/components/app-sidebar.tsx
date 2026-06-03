"use client"

import * as React from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { useUser } from "@clerk/nextjs"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar"
import { NavUser } from "@/components/nav-user"
import {
  HomeIcon,
  TrendingUpIcon,
  LightbulbIcon,
  UserIcon,
  PlusIcon,
  Settings2Icon,
  CircleHelpIcon,
  FlameIcon
} from "lucide-react"

interface AppSidebarProps extends React.ComponentProps<typeof Sidebar> {
  isAdmin?: boolean
}

export function AppSidebar({ isAdmin = false, ...props }: AppSidebarProps) {
  const pathname = usePathname()
  const { user, isLoaded } = useUser()
  const { toggleSidebar } = useSidebar()

  // Format Clerk user for the NavUser footer
  const userData = React.useMemo(() => {
    if (!isLoaded || !user) {
      return {
        name: "Loading...",
        email: "please wait",
        avatar: "",
      }
    }
    return {
      name: user.fullName || user.firstName || "User",
      email: user.primaryEmailAddress?.emailAddress || "",
      avatar: user.imageUrl,
    }
  }, [user, isLoaded])

  // Navigation items matching the desktop layout mockup
  const navigationItems = [
    {
      title: "Home",
      url: "/",
      icon: HomeIcon,
    },
    {
      title: "Trades",
      url: "/user/portfolio",
      icon: TrendingUpIcon,
    },
    {
      title: "Suggest",
      url: "/user/suggest",
      icon: LightbulbIcon,
    },
    {
      title: "Profile",
      url: "/user",
      icon: UserIcon,
    },
  ]

  return (
    <Sidebar collapsible="offcanvas" {...props}>
      <SidebarHeader className=" border-b border-zinc-200/50 p-4 dark:border-zinc-800/50">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              size="lg"
              className="hover:bg-transparent active:bg-transparent"
              render={<Link href="/user" />}
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

      <SidebarFooter className="border-t border-zinc-200/50 p-4 gap-4 dark:border-zinc-800/50">
        {/* Render Create Market button ONLY if the user is an admin */}
        {isAdmin && (
          <Link
            href="/admin"
            className="flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-[#4F46E5] text-sm font-semibold text-white shadow-sm transition-all hover:bg-[#4338CA] active:scale-[0.98]"
          >
            <PlusIcon className="size-4" />
            <span>Create Market</span>
          </Link>
        )}

        {/* Secondary options */}
        <div className="flex flex-col gap-1">
          <Link
            href="/support"
            className="flex items-center gap-3 px-3 py-2 text-sm font-medium text-zinc-600 rounded-xl hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-900 dark:hover:text-zinc-50 transition-colors"
          >
            <CircleHelpIcon className="size-4 text-zinc-500" />
            <span>Support</span>
          </Link>
        </div>

        {/* Clerk User dropdown */}
        <div className="pt-2 border-t border-zinc-100 dark:border-zinc-800">
          <NavUser user={userData} />
        </div>
      </SidebarFooter>
    </Sidebar>
  )
}
