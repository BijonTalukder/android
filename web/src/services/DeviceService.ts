/**
 * Stable import path for the device service.
 *
 * The implementation lives in `modules/device` next to its schemas, DTOs and
 * repository concerns; this file is the published entry point so that the
 * module's internals can be reorganised (or extracted into a separate service)
 * without touching consumers.
 */
export { DeviceService } from "@/modules/device/device.service";
export type { EnrollmentTokenDto } from "@/modules/device/device.service";
export { DeviceLogService } from "@/modules/device/device-log.service";
export { sweepStaleDevices } from "@/modules/device/device.presence";
export { toDeviceDto, type DeviceDto } from "@/modules/device/device.dto";
