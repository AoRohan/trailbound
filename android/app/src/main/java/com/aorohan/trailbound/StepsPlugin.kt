package com.aorohan.trailbound

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.SharedPreferences
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import androidx.activity.result.ActivityResult
import androidx.health.connect.client.HealthConnectClient
import androidx.health.connect.client.PermissionController
import androidx.health.connect.client.permission.HealthPermission
import androidx.health.connect.client.records.StepsRecord
import androidx.health.connect.client.request.AggregateGroupByDurationRequest
import androidx.health.connect.client.time.TimeRangeFilter
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PermissionState
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.ActivityCallback
import com.getcapacitor.annotation.CapacitorPlugin
import com.getcapacitor.annotation.Permission
import com.getcapacitor.annotation.PermissionCallback
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import java.time.Duration
import java.time.Instant

/**
 * Trailbound's step bridge.
 *
 * Two sources, in order of preference:
 *
 *  1. **Health Connect** — the on-device health store. Gives timestamped
 *     buckets with history, aggregated across the phone, Google Fit, Samsung
 *     Health and any watch. The buckets are what make bout detection possible,
 *     which is how the game rewards a real walk without ever asking where you
 *     were.
 *  2. **TYPE_STEP_COUNTER** — the hardware counter, cumulative since boot and
 *     maintained by the sensor hub whether or not this app is running. Costs
 *     essentially no battery and needs no background service: we just read the
 *     total when the app opens and diff it against the last reading. The price
 *     is that it is a single number, so we cannot tell *when* the steps
 *     happened.
 *
 * Neither path touches location. The manifest declares no location permission
 * at all.
 */
@CapacitorPlugin(
    name = "Steps",
    permissions = [
        Permission(
            alias = StepsPlugin.ACTIVITY_RECOGNITION_ALIAS,
            strings = [Manifest.permission.ACTIVITY_RECOGNITION],
        )
    ],
)
class StepsPlugin : Plugin() {

    companion object {
        const val ACTIVITY_RECOGNITION_ALIAS = "activityRecognition"

        private const val PREFS = "trailbound.steps"
        private const val KEY_LAST_COUNTER = "lastCounter"
        private const val KEY_LAST_COUNTER_AT = "lastCounterAt"

        /** Bucket width requested from Health Connect. */
        private val SLICE: Duration = Duration.ofMinutes(15)

        /**
         * Never credit more than this in one sync.
         *
         * A phone left in a drawer for a fortnight would otherwise hand over
         * two weeks of steps at once and blast the party through a dozen
         * biomes in a single tap, which reads as a bug rather than a reward.
         */
        private val MAX_BACKFILL: Duration = Duration.ofDays(4)

        /** How long to wait for the step counter to report. */
        private const val SENSOR_TIMEOUT_MS = 4_000L
    }

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    private var lastError: String? = null

    private val prefs: SharedPreferences
        get() = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    private val healthClient: HealthConnectClient?
        get() = try {
            if (healthSdkStatus() == HealthConnectClient.SDK_AVAILABLE) {
                HealthConnectClient.getOrCreate(context)
            } else {
                null
            }
        } catch (e: Throwable) {
            lastError = "Health Connect unavailable: ${e.message}"
            null
        }

    private fun healthSdkStatus(): Int =
        try {
            HealthConnectClient.getSdkStatus(context)
        } catch (e: Throwable) {
            HealthConnectClient.SDK_UNAVAILABLE
        }

    private val readStepsPermission: String
        get() = HealthPermission.getReadPermission(StepsRecord::class)

    private fun stepCounterSensor(): Sensor? {
        val manager = context.getSystemService(Context.SENSOR_SERVICE) as? SensorManager
        return manager?.getDefaultSensor(Sensor.TYPE_STEP_COUNTER)
    }

    private fun hasActivityRecognition(): Boolean {
        // The permission only exists from Android 10; before that the sensor is
        // readable without it.
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return true
        return getPermissionState(ACTIVITY_RECOGNITION_ALIAS) == PermissionState.GRANTED
    }

    override fun handleOnDestroy() {
        scope.cancel()
        super.handleOnDestroy()
    }

    // -----------------------------------------------------------------------
    // status
    // -----------------------------------------------------------------------

    /**
     * Describe the world in words.
     *
     * The diagnostics screen renders this verbatim. On-device debugging is a
     * screenshot round-trip, so a source that cannot explain itself is a source
     * nobody can fix.
     */
    @PluginMethod
    fun status(call: PluginCall) {
        scope.launch {
            val sdkStatus = healthSdkStatus()
            val sensor = stepCounterSensor()
            val client = healthClient

            var healthGranted = false
            if (client != null) {
                healthGranted = try {
                    client.permissionController.getGrantedPermissions()
                        .contains(readStepsPermission)
                } catch (e: Throwable) {
                    lastError = "Permission check failed: ${e.message}"
                    false
                }
            }

            val result = JSObject()
            when {
                client != null && healthGranted -> {
                    result.put("kind", "health-connect")
                    result.put("label", "Health Connect")
                    result.put("available", true)
                    result.put("permissionGranted", true)
                    result.put("detail", "Reading ${SLICE.toMinutes()}-minute step buckets")
                }
                client != null -> {
                    result.put("kind", "health-connect")
                    result.put("label", "Health Connect")
                    result.put("available", true)
                    result.put("permissionGranted", false)
                    result.put("detail", "Installed, but not yet allowed to read steps")
                }
                sensor != null -> {
                    val granted = hasActivityRecognition()
                    result.put("kind", "sensor")
                    result.put("label", "Step counter sensor")
                    result.put("available", true)
                    result.put("permissionGranted", granted)
                    result.put(
                        "detail",
                        if (granted) {
                            "Hardware counter, last reading ${lastCounterDescription()}"
                        } else {
                            "Needs physical activity permission"
                        },
                    )
                }
                else -> {
                    result.put("kind", "sensor")
                    result.put("label", "No step hardware")
                    result.put("available", false)
                    result.put("permissionGranted", false)
                    result.put(
                        "detail",
                        when (sdkStatus) {
                            HealthConnectClient.SDK_UNAVAILABLE_PROVIDER_UPDATE_REQUIRED ->
                                "Health Connect needs updating, and this phone has no step counter"
                            else ->
                                "Neither Health Connect nor a step counter is available"
                        },
                    )
                }
            }

            result.put("healthConnectSdkStatus", sdkStatus)
            result.put("hasStepCounter", sensor != null)
            result.put("error", lastError)
            call.resolve(result)
        }
    }

    private fun lastCounterDescription(): String {
        val at = prefs.getLong(KEY_LAST_COUNTER_AT, 0L)
        if (at == 0L) return "none yet"
        val value = prefs.getFloat(KEY_LAST_COUNTER, 0f).toLong()
        return "$value at ${Instant.ofEpochMilli(at)}"
    }

    // -----------------------------------------------------------------------
    // permissions
    // -----------------------------------------------------------------------

    @PluginMethod
    fun requestPermission(call: PluginCall) {
        val client = healthClient
        if (client != null) {
            val contract = PermissionController.createRequestPermissionResultContract()
            val intent: Intent = contract.createIntent(context, setOf(readStepsPermission))
            startActivityForResult(call, intent, "healthPermissionResult")
            return
        }

        if (stepCounterSensor() != null && !hasActivityRecognition()) {
            requestPermissionForAlias(ACTIVITY_RECOGNITION_ALIAS, call, "activityPermissionResult")
            return
        }

        val result = JSObject()
        result.put("granted", hasActivityRecognition() && stepCounterSensor() != null)
        call.resolve(result)
    }

    @ActivityCallback
    private fun healthPermissionResult(call: PluginCall?, activityResult: ActivityResult) {
        if (call == null) return
        val granted = try {
            val contract = PermissionController.createRequestPermissionResultContract()
            contract
                .parseResult(activityResult.resultCode, activityResult.data)
                .contains(readStepsPermission)
        } catch (e: Throwable) {
            lastError = "Permission result failed: ${e.message}"
            false
        }
        val result = JSObject()
        result.put("granted", granted)
        call.resolve(result)
    }

    @PermissionCallback
    private fun activityPermissionResult(call: PluginCall) {
        val result = JSObject()
        result.put("granted", hasActivityRecognition())
        call.resolve(result)
    }

    // -----------------------------------------------------------------------
    // fetch
    // -----------------------------------------------------------------------

    @PluginMethod
    fun fetch(call: PluginCall) {
        val now = call.getLong("now") ?: System.currentTimeMillis()
        val requestedSince = call.getLong("since") ?: (now - Duration.ofHours(12).toMillis())
        val since = maxOf(requestedSince, now - MAX_BACKFILL.toMillis())

        if (since >= now) {
            call.resolve(emptyResult("sync window is empty"))
            return
        }

        scope.launch {
            val client = healthClient
            if (client != null) {
                val granted = try {
                    client.permissionController.getGrantedPermissions()
                        .contains(readStepsPermission)
                } catch (e: Throwable) {
                    lastError = "Permission check failed: ${e.message}"
                    false
                }

                if (granted) {
                    val fromHealth = readHealthConnect(client, since, now)
                    if (fromHealth != null) {
                        call.resolve(fromHealth)
                        return@launch
                    }
                    // Health Connect was there but failed; fall through to the
                    // sensor rather than silently reporting zero steps.
                }
            }

            readSensor(since, now, call)
        }
    }

    private fun emptyResult(note: String): JSObject {
        val result = JSObject()
        result.put("source", "none")
        result.put("buckets", JSArray())
        result.put("note", note)
        result.put("error", lastError)
        return result
    }

    private suspend fun readHealthConnect(
        client: HealthConnectClient,
        since: Long,
        now: Long,
    ): JSObject? {
        return try {
            val response = client.aggregateGroupByDuration(
                AggregateGroupByDurationRequest(
                    metrics = setOf(StepsRecord.COUNT_TOTAL),
                    timeRangeFilter = TimeRangeFilter.between(
                        Instant.ofEpochMilli(since),
                        Instant.ofEpochMilli(now),
                    ),
                    timeRangeSlicer = SLICE,
                ),
            )

            val buckets = JSArray()
            var total = 0L
            for (bucket in response) {
                val count = bucket.result[StepsRecord.COUNT_TOTAL] ?: continue
                if (count <= 0) continue
                total += count

                // aggregateGroupByDuration buckets carry Instants directly.
                // (The Period variant hands back LocalDateTime instead — easy
                // to mix up, and it would not compile.)
                val entry = JSObject()
                entry.put("start", bucket.startTime.toEpochMilli())
                entry.put("end", bucket.endTime.toEpochMilli())
                entry.put("steps", count)
                buckets.put(entry)
            }

            lastError = null
            val result = JSObject()
            result.put("source", "health-connect")
            result.put("buckets", buckets)
            result.put("note", "$total steps in ${buckets.length()} buckets")
            result.put("error", null)
            result
        } catch (e: Throwable) {
            lastError = "Health Connect read failed: ${e.message}"
            null
        }
    }

    /**
     * Read the cumulative hardware counter and turn the change since last time
     * into a single bucket.
     *
     * The counter resets to zero on reboot, so a reading lower than the stored
     * one means the phone restarted; everything the counter now reports has
     * happened since then, which is necessarily after our last read. Steps
     * taken between the last read and the reboot are gone, and that is the
     * honest cost of not running a background service.
     */
    private fun readSensor(since: Long, now: Long, call: PluginCall) {
        val manager = context.getSystemService(Context.SENSOR_SERVICE) as? SensorManager
        val sensor = manager?.getDefaultSensor(Sensor.TYPE_STEP_COUNTER)

        if (manager == null || sensor == null) {
            call.resolve(emptyResult("no step counter on this device"))
            return
        }
        if (!hasActivityRecognition()) {
            call.resolve(emptyResult("physical activity permission not granted"))
            return
        }

        val handler = Handler(Looper.getMainLooper())
        var settled = false

        val listener = object : SensorEventListener {
            override fun onSensorChanged(event: SensorEvent) {
                if (settled) return
                settled = true
                manager.unregisterListener(this)

                val current = event.values.firstOrNull() ?: 0f
                val previous = prefs.getFloat(KEY_LAST_COUNTER, -1f)
                val previousAt = prefs.getLong(KEY_LAST_COUNTER_AT, since)

                val delta = when {
                    previous < 0f -> 0f // first ever reading: establish a baseline only
                    current < previous -> current // rebooted
                    else -> current - previous
                }

                prefs.edit()
                    .putFloat(KEY_LAST_COUNTER, current)
                    .putLong(KEY_LAST_COUNTER_AT, now)
                    .apply()

                val buckets = JSArray()
                if (delta > 0f) {
                    val entry = JSObject()
                    entry.put("start", maxOf(previousAt, since).coerceAtMost(now - 1))
                    entry.put("end", now)
                    entry.put("steps", delta.toLong())
                    buckets.put(entry)
                }

                val result = JSObject()
                result.put("source", "sensor")
                result.put("buckets", buckets)
                result.put(
                    "note",
                    if (previous < 0f) {
                        "first reading — baseline set at ${current.toLong()}"
                    } else {
                        "${delta.toLong()} steps since the last reading"
                    },
                )
                result.put("error", lastError)
                call.resolve(result)
            }

            override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) = Unit
        }

        // A counter that never reports must not hang the sync forever.
        handler.postDelayed({
            if (settled) return@postDelayed
            settled = true
            manager.unregisterListener(listener)
            call.resolve(emptyResult("step counter did not report in time"))
        }, SENSOR_TIMEOUT_MS)

        manager.registerListener(listener, sensor, SensorManager.SENSOR_DELAY_FASTEST)
    }
}
