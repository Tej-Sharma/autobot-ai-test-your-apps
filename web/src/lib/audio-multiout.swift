// Create (or reuse) a stacked Multi-Output aggregate device whose clock master is a
// REAL output device, plus BlackHole (drift-corrected). Routing the Simulator/browser
// output to BlackHole *alone* crashes clock-sensitive voice apps (VPIO/.voiceChat):
// BlackHole is clockless, and AURemoteIO times out waiting for a hardware clock →
// abort()/SIGABRT. A Multi-Output with a real clock master is the stable path.
//
// Usage:
//   swift audio-multiout.swift create <name> <uid> [preferred-master-uid]   → prints aggregate name
//   swift audio-multiout.swift destroy <uid>                                → removes it
//
// Exit non-zero on failure (caller falls back to leaving output on the real device).

import CoreAudio
import Foundation

func err(_ s: String) { FileHandle.standardError.write((s + "\n").data(using: .utf8)!) }

func allDevices() -> [AudioDeviceID] {
    var addr = AudioObjectPropertyAddress(
        mSelector: kAudioHardwarePropertyDevices,
        mScope: kAudioObjectPropertyScopeGlobal,
        mElement: kAudioObjectPropertyElementMain)
    var size: UInt32 = 0
    guard AudioObjectGetPropertyDataSize(AudioObjectID(kAudioObjectSystemObject), &addr, 0, nil, &size) == noErr else { return [] }
    let n = Int(size) / MemoryLayout<AudioDeviceID>.size
    var ids = [AudioDeviceID](repeating: 0, count: n)
    guard AudioObjectGetPropertyData(AudioObjectID(kAudioObjectSystemObject), &addr, 0, nil, &size, &ids) == noErr else { return [] }
    return ids
}

func stringProp(_ id: AudioDeviceID, _ selector: AudioObjectPropertySelector) -> String? {
    var addr = AudioObjectPropertyAddress(mSelector: selector, mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
    var size = UInt32(MemoryLayout<CFString?>.size)
    var cf: CFString? = nil
    let status = withUnsafeMutablePointer(to: &cf) {
        AudioObjectGetPropertyData(id, &addr, 0, nil, &size, $0)
    }
    return status == noErr ? (cf as String?) : nil
}

func deviceUID(_ id: AudioDeviceID) -> String? { stringProp(id, kAudioDevicePropertyDeviceUID) }
func deviceName(_ id: AudioDeviceID) -> String? { stringProp(id, kAudioObjectPropertyName) }

func outputChannels(_ id: AudioDeviceID) -> Int {
    var addr = AudioObjectPropertyAddress(mSelector: kAudioDevicePropertyStreamConfiguration, mScope: kAudioObjectPropertyScopeOutput, mElement: kAudioObjectPropertyElementMain)
    var size: UInt32 = 0
    guard AudioObjectGetPropertyDataSize(id, &addr, 0, nil, &size) == noErr, size > 0 else { return 0 }
    let raw = UnsafeMutableRawPointer.allocate(byteCount: Int(size), alignment: MemoryLayout<AudioBufferList>.alignment)
    defer { raw.deallocate() }
    guard AudioObjectGetPropertyData(id, &addr, 0, nil, &size, raw) == noErr else { return 0 }
    let abl = UnsafeMutableAudioBufferListPointer(raw.assumingMemoryBound(to: AudioBufferList.self))
    return abl.reduce(0) { $0 + Int($1.mNumberChannels) }
}

func isAggregate(_ id: AudioDeviceID) -> Bool {
    var addr = AudioObjectPropertyAddress(mSelector: kAudioDevicePropertyTransportType, mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
    var t: UInt32 = 0; var size = UInt32(MemoryLayout<UInt32>.size)
    AudioObjectGetPropertyData(id, &addr, 0, nil, &size, &t)
    return t == kAudioDeviceTransportTypeAggregate
}

func defaultOutput() -> AudioDeviceID? {
    var addr = AudioObjectPropertyAddress(mSelector: kAudioHardwarePropertyDefaultOutputDevice, mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
    var id = AudioDeviceID(0); var size = UInt32(MemoryLayout<AudioDeviceID>.size)
    guard AudioObjectGetPropertyData(AudioObjectID(kAudioObjectSystemObject), &addr, 0, nil, &size, &id) == noErr else { return nil }
    return id
}

func isRealOutput(_ id: AudioDeviceID) -> Bool {
    guard outputChannels(id) > 0, !isAggregate(id) else { return false }
    if let n = deviceName(id), n.contains("BlackHole") { return false }
    return true
}

func findByUID(_ uid: String) -> AudioDeviceID? {
    for d in allDevices() where deviceUID(d) == uid { return d }
    return nil
}

let args = CommandLine.arguments
guard args.count >= 2 else { err("usage: <create|destroy> ..."); exit(2) }
let mode = args[1]

if mode == "destroy" {
    guard args.count >= 3, let id = findByUID(args[2]) else { exit(0) } // nothing to do
    exit(AudioHardwareDestroyAggregateDevice(id) == noErr ? 0 : 5)
}

guard mode == "create", args.count >= 4 else { err("usage: create <name> <uid> [master-uid]"); exit(2) }
let aggName = args[2]
let aggUID  = args[3]
let preferredMaster = args.count >= 5 ? args[4] : ""

// Reuse if our aggregate already exists.
if let existing = findByUID(aggUID) { print(deviceName(existing) ?? aggName); exit(0) }

// BlackHole UID.
var blackhole: String? = nil
for d in allDevices() {
    if let n = deviceName(d), n.contains("BlackHole"), let u = deviceUID(d) { blackhole = u; break }
}
guard let bhUID = blackhole else { err("no BlackHole device present"); exit(3) }

// Pick a real output device as the clock master.
var masterUID: String? = nil
if !preferredMaster.isEmpty, let d = findByUID(preferredMaster), isRealOutput(d) { masterUID = preferredMaster }
if masterUID == nil, let d = defaultOutput(), isRealOutput(d) { masterUID = deviceUID(d) }
if masterUID == nil { for d in allDevices() where isRealOutput(d) { masterUID = deviceUID(d); break } }
guard let mUID = masterUID else { err("no real output device available as clock master"); exit(4) }

let desc: [String: Any] = [
    kAudioAggregateDeviceNameKey as String: aggName,
    kAudioAggregateDeviceUIDKey as String: aggUID,
    kAudioAggregateDeviceIsStackedKey as String: 1,                 // stacked == Multi-Output
    kAudioAggregateDeviceMasterSubDeviceKey as String: mUID,        // real hardware clock
    kAudioAggregateDeviceSubDeviceListKey as String: [
        [kAudioSubDeviceUIDKey as String: mUID],
        [kAudioSubDeviceUIDKey as String: bhUID,
         kAudioSubDeviceDriftCompensationKey as String: 1],
    ],
]

var aggID = AudioDeviceID(0)
let status = AudioHardwareCreateAggregateDevice(desc as CFDictionary, &aggID)
guard status == noErr, aggID != 0 else { err("AudioHardwareCreateAggregateDevice failed: \(status)"); exit(5) }
print(deviceName(aggID) ?? aggName)
exit(0)
