import { type VariationLicenseInfo } from './interfaces/VariationLicenseInfo'


export class VariationLicenseCatalog {
  private static readonly license_info_by_key: Record<string, VariationLicenseInfo> = {
    cc0: {
      description: 'Public domain dedication. You can use, modify, and redistribute this asset without attribution.'
    },
    'cc-by': {
      description: 'Use is allowed, including commercial use, but attribution to the creator is required.'
    },
    'cc-sa': {
      description: 'Use and modification are allowed, but derivative works must be shared under the same license.'
    }
  }

  // try to catch small variations on license with typos. Probably over-engineered code.
  private static normalize_license_key (license_name: string): string {
    const normalized = license_name.toLowerCase().trim()
    if (normalized.includes('cc0')) return 'cc0'
    if (normalized.includes('cc-by-sa') || normalized.includes('cc-sa')) return 'cc-sa'
    if (normalized.includes('cc-by')) return 'cc-by'

    return normalized
  }

  static get_license_info (license_name: string): VariationLicenseInfo {
    const normalized_key = this.normalize_license_key(license_name)

    return this.license_info_by_key[normalized_key] ?? {
      description: 'License details are not available yet. Please verify usage terms before redistribution.'
    }
  }
}