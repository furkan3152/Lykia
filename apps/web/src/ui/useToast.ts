import { toast, type ToastApi } from "./toast";

/**
 * The toast API for components: `const toast = useToast(); toast.success("Copied")`.
 * The store is module-level, so this is stable across renders and also usable
 * outside React through `import { toast } from "../ui/toast"`.
 */
export function useToast(): ToastApi {
  return toast;
}
