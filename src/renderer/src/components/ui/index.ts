// Vault design system — public barrel of UI primitives.
//
// Every existing export from the previous Champagne-Noir barrel survives.
// New shadcn-canonical primitives (Dialog, Sheet, AlertDialog, Popover,
// ScrollArea, Separator, Switch, Label, Command, Toaster) are added so
// new code can use them by name. The legacy flat APIs (Tabs / Toggle /
// Select / Tooltip / DropdownMenu / ContextMenu / Modal) remain
// drop-in compatible with current call-sites.

// ── Foundational primitives ─────────────────────────────────────────────
export { Button, buttonVariants, type ButtonProps } from './Button'
export { Input, type InputProps } from './Input'
export { Badge, badgeVariants, type BadgeProps, type BadgeVariant } from './Badge'
export { Label, labelVariants, type LabelProps } from './Label'
export { Switch } from './Switch'
export { Toggle, type ToggleProps } from './Toggle'

// ── Form selects ────────────────────────────────────────────────────────
export {
  Select,
  type SelectProps,
  // canonical shadcn family
  SelectRoot,
  SelectGroup,
  SelectValue,
  SelectTrigger,
  SelectContent,
  SelectLabel,
  SelectItem,
  SelectSeparator,
  SelectScrollUpButton,
  SelectScrollDownButton
} from './Select'

// ── Cards / structure ────────────────────────────────────────────────────
export {
  Card,
  type CardProps,
  // canonical shadcn family
  CardRoot,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter
} from './Card'
export { EmptyState, type EmptyStateProps } from './EmptyState'
export { Separator } from './Separator'
export { ScrollArea, ScrollBar } from './ScrollArea'

// ── Inputs / search ─────────────────────────────────────────────────────
export { SearchInput, type SearchInputProps } from './SearchInput'

// ── Overlays — Dialog / Modal / Sheet / AlertDialog / Popover / Tooltip ─
export {
  Dialog,
  DialogPortal,
  DialogOverlay,
  DialogTrigger,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
  type DialogContentProps
} from './Dialog'

export { Modal, type ModalProps } from './Modal'

export {
  Sheet,
  SheetPortal,
  SheetOverlay,
  SheetTrigger,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetFooter,
  SheetTitle,
  SheetDescription,
  sheetVariants,
  type SheetContentProps
} from './Sheet'

export {
  AlertDialog,
  AlertDialogPortal,
  AlertDialogOverlay,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogAction,
  AlertDialogCancel
} from './AlertDialog'

export { Popover, PopoverTrigger, PopoverContent, PopoverAnchor } from './Popover'

export {
  Tooltip,
  type TooltipProps,
  TooltipProvider,
  TooltipRoot,
  TooltipTrigger,
  TooltipContent
} from './Tooltip'

// ── Tabs ────────────────────────────────────────────────────────────────
export {
  Tabs,
  type TabsProps,
  // canonical shadcn family
  TabsRoot,
  TabsList,
  TabsTrigger,
  TabsContent
} from './Tabs'

// ── Menus ───────────────────────────────────────────────────────────────
export {
  DropdownMenu,
  type DropdownMenuProps,
  type DropdownMenuItem,
  // canonical shadcn family (note: legacy `DropdownMenuItem` is the data
  // shape passed to the flat API, so the canonical Item primitive is
  // exported as `DropdownMenuItemPrimitive` to avoid the name clash)
  DropdownMenuRoot,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItemPrimitive,
  DropdownMenuCheckboxItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuGroup,
  DropdownMenuPortal,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuRadioGroup
} from './DropdownMenu'

export {
  ContextMenu,
  type ContextMenuProps,
  // canonical shadcn family
  ContextMenuRoot,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItemPrimitive,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuGroup,
  ContextMenuPortal,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuRadioGroup
} from './ContextMenu'

// ── Command palette ─────────────────────────────────────────────────────
export {
  Command,
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandShortcut,
  CommandSeparator
} from './Command'

// ── Toaster (Sonner) ────────────────────────────────────────────────────
export { Toaster } from './Sonner'
