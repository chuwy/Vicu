// Vicu's speech helper for macOS: Apple's speech recognizer (SFSpeechRecognizer) on the default
// microphone, streaming what it hears as JSON lines on stdout. The main process starts it for one
// utterance (src/main/voice/macos-engine.ts) and talks to it over stdin. docs/voice-input.md.
//
// stdout, one JSON object per line:
//   {"type":"ready"}                         listening
//   {"type":"partial","text":"Call mom to"}  the words so far (replaces the previous partial)
//   {"type":"final","text":"Call mom tomorrow"}  the last result; the helper exits after it
//   {"type":"error","code":"...","message":"..."}  then exits (codes: see helper-protocol.ts)
//   {"type":"check",...}                     only with --check
// stdin, one command per line: "stop" (finish, send the final text) or "cancel" (exit at once).
// End of stdin is "cancel", so the helper never outlives the app.
//
// Build: node scripts/build-voice-helper.mjs (swiftc, with Info.plist linked in for the usage
// strings macOS asks for).

import AVFoundation
import Foundation
import Speech

setvbuf(stdout, nil, _IOLBF, 0)

let outputLock = NSLock()

func emit(_ object: [String: Any]) {
    guard let data = try? JSONSerialization.data(withJSONObject: object),
          let line = String(data: data, encoding: .utf8) else { return }
    outputLock.lock()
    FileHandle.standardOutput.write((line + "\n").data(using: .utf8)!)
    outputLock.unlock()
}

func fail(_ code: String, _ message: String) -> Never {
    emit(["type": "error", "code": code, "message": message])
    exit(1)
}

func authorizationName(_ status: SFSpeechRecognizerAuthorizationStatus) -> String {
    switch status {
    case .authorized: return "authorized"
    case .denied: return "denied"
    case .restricted: return "restricted"
    case .notDetermined: return "not-determined"
    @unknown default: return "unknown"
    }
}

var arguments = CommandLine.arguments.dropFirst()
var localeId: String?
var checkOnly = false
while let argument = arguments.popFirst() {
    switch argument {
    case "--check": checkOnly = true
    case "--locale": localeId = arguments.popFirst()
    default: break
    }
}

let recognizer: SFSpeechRecognizer? = {
    if let id = localeId, let named = SFSpeechRecognizer(locale: Locale(identifier: id)) { return named }
    return SFSpeechRecognizer()
}()

if checkOnly {
    // Only reads the state; never asks for a permission.
    emit([
        "type": "check",
        "available": recognizer?.isAvailable ?? false,
        "onDevice": recognizer?.supportsOnDeviceRecognition ?? false,
        "authorization": authorizationName(SFSpeechRecognizer.authorizationStatus()),
        "microphone": {
            switch AVCaptureDevice.authorizationStatus(for: .audio) {
            case .authorized: return "authorized"
            case .denied: return "denied"
            case .restricted: return "restricted"
            case .notDetermined: return "not-determined"
            @unknown default: return "unknown"
            }
        }(),
        "locale": recognizer?.locale.identifier ?? "",
    ])
    exit(0)
}

guard let recognizer else { fail("no-recognizer", "Speech recognition does not support this language.") }

/// Holds the session so the callbacks and the stdin reader share one place.
final class Session {
    let engine = AVAudioEngine()
    let request = SFSpeechAudioBufferRecognitionRequest()
    var task: SFSpeechRecognitionTask?
    var lastText = ""
    var finished = false
    var stopping = false
    let lock = NSLock()

    func finish(_ text: String) {
        lock.lock()
        if finished { lock.unlock(); return }
        finished = true
        lock.unlock()
        emit(["type": "final", "text": text])
        exit(0)
    }

    func stop() {
        lock.lock()
        if stopping || finished { lock.unlock(); return }
        stopping = true
        lock.unlock()
        engine.stop()
        engine.inputNode.removeTap(onBus: 0)
        request.endAudio()
        // The recognizer normally answers with a final result at once; never wait long for it.
        DispatchQueue.main.asyncAfter(deadline: .now() + 2.5) { [self] in finish(lastText) }
    }

    func cancel() {
        task?.cancel()
        exit(0)
    }

    func start(on recognizer: SFSpeechRecognizer) {
        request.shouldReportPartialResults = true
        // On this Mac when the language allows it: nothing leaves the computer.
        if recognizer.supportsOnDeviceRecognition { request.requiresOnDeviceRecognition = true }
        if #available(macOS 13, *) { request.addsPunctuation = false }

        let input = engine.inputNode
        let format = input.outputFormat(forBus: 0)
        guard format.sampleRate > 0, format.channelCount > 0 else {
            fail("audio", "No microphone is available.")
        }
        input.installTap(onBus: 0, bufferSize: 1024, format: format) { [request] buffer, _ in
            request.append(buffer)
        }
        engine.prepare()
        do {
            try engine.start()
        } catch {
            fail("audio", "The microphone could not be started: \(error.localizedDescription)")
        }

        task = recognizer.recognitionTask(with: request) { [self] result, error in
            if let result {
                let text = result.bestTranscription.formattedString
                lock.lock(); lastText = text; lock.unlock()
                if result.isFinal {
                    finish(text)
                } else {
                    emit(["type": "partial", "text": text])
                }
            }
            if let error {
                lock.lock(); let wasStopping = stopping; lock.unlock()
                // After "stop", an error such as "no speech detected" just means the final text is
                // what was heard so far (possibly nothing).
                if wasStopping { finish(lastText); return }
                fail("failed", error.localizedDescription)
            }
        }
        emit(["type": "ready"])

        // Apple's recognizer stops after about a minute; end cleanly before that.
        DispatchQueue.main.asyncAfter(deadline: .now() + 55) { [self] in stop() }
    }
}

let session = Session()

func readCommands() {
    Thread.detachNewThread {
        while let line = readLine(strippingNewline: true) {
            switch line.trimmingCharacters(in: .whitespaces) {
            case "stop": DispatchQueue.main.async { session.stop() }
            case "cancel": DispatchQueue.main.async { session.cancel() }
            default: break
            }
        }
        // stdin closed: the app is gone or no longer wants us.
        DispatchQueue.main.async { session.cancel() }
    }
}

func begin() {
    guard recognizer.isAvailable else {
        fail("unavailable", "Speech recognition is not available right now.")
    }
    switch AVCaptureDevice.authorizationStatus(for: .audio) {
    case .denied, .restricted:
        fail("mic-denied", "Vicu may not use the microphone. Allow it in System Settings, Privacy & Security, Microphone.")
    default: break
    }
    session.start(on: recognizer)
}

readCommands()
switch SFSpeechRecognizer.authorizationStatus() {
case .authorized:
    begin()
case .notDetermined:
    SFSpeechRecognizer.requestAuthorization { status in
        DispatchQueue.main.async {
            if status == .authorized { begin() }
            else { fail("speech-denied", "Vicu may not use speech recognition. Allow it in System Settings, Privacy & Security, Speech Recognition.") }
        }
    }
default:
    fail("speech-denied", "Vicu may not use speech recognition. Allow it in System Settings, Privacy & Security, Speech Recognition.")
}

dispatchMain()
