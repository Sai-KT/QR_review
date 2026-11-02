/**
 * MerchantLayout
 *
 * Re-exports the canonical PortalLayout from src/components/merchant/PortalLayout.tsx.
 * Provides backwards compatibility for any modules or tests expecting MerchantLayout.
 */

export { PortalLayout as MerchantLayout } from '../merchant/PortalLayout';
export type { PortalLayoutProps as MerchantLayoutProps } from '../merchant/PortalLayout';
export { PortalLayout as default } from '../merchant/PortalLayout';
