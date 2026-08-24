"use client"

import { useTheme } from "next-themes"
import { Toaster as Sonner, type ToasterProps } from "sonner"
import { CircleCheckIcon, InfoIcon, TriangleAlertIcon, OctagonXIcon, Loader2Icon } from "lucide-react"

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme()

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className="toaster group"
      // Owner request: ALL toasts render at the TOP of the viewport so they
      // can never be covered by the bottom Quick Add / edit sheets or the
      // mobile nav. The offset drops them just below the sticky app header
      // and clears the iOS notch via the safe-area inset.
      position="top-center"
      offset={`calc(4rem + env(safe-area-inset-top))`}
      // Owner request: multiple toasts stack fully expanded, one above
      // another — Sonner's default collapses older toasts behind the newest
      // and only fans them out on hover, which hides feedback like a
      // simultaneous "Transaction added" + budget warning.
      expand
      visibleToasts={4}
      icons={{
        success: (
          <CircleCheckIcon className="size-4" />
        ),
        info: (
          <InfoIcon className="size-4" />
        ),
        warning: (
          <TriangleAlertIcon className="size-4" />
        ),
        error: (
          <OctagonXIcon className="size-4" />
        ),
        loading: (
          <Loader2Icon className="size-4 animate-spin" />
        ),
      }}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
          "--border-radius": "var(--radius)",
        } as React.CSSProperties
      }
      toastOptions={{
        classNames: {
          toast: "cn-toast",
        },
      }}
      {...props}
    />
  )
}

export { Toaster }
