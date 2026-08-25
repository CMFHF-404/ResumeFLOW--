import asyncio
import base64
import io
import threading
import time
import unittest
import zipfile
import zlib
from unittest.mock import Mock, patch

from fastapi import UploadFile
from pypdf import PdfWriter
from pypdf.generic import ArrayObject, EncodedStreamObject, NameObject

from app.domain.ai import jd_attachment_service
from app.domain.parser import bounded_document_extractor
from app.domain.parser.bounded_document_extractor import (
    DocumentExtractionLimitError,
    DocumentExtractionTimeoutError,
)


def _docx_bytes(entries: list[tuple[str, bytes]]) -> bytes:
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for name, payload in entries:
            archive.writestr(name, payload)
    return output.getvalue()


def _minimal_docx_bytes() -> bytes:
    return _docx_bytes(
        [
            ("[Content_Types].xml", b"<Types/>"),
            ("word/document.xml", b"<w:document><w:p/></w:document>"),
        ]
    )


def _blank_pdf_bytes() -> bytes:
    output = io.BytesIO()
    writer = PdfWriter()
    writer.add_blank_page(width=612, height=792)
    writer.write(output)
    return output.getvalue()


def _ascii85_flate_bomb_pdf_bytes() -> bytes:
    output = io.BytesIO()
    writer = PdfWriter()
    page = writer.add_blank_page(width=612, height=792)
    decoded_content = b"q\n" + (b" " * (9 * 1024 * 1024)) + b"\nQ"
    encoded_content = base64.a85encode(
        zlib.compress(decoded_content),
        adobe=True,
    )
    stream = EncodedStreamObject()
    stream._data = encoded_content
    stream[NameObject("/Filter")] = ArrayObject(
        [NameObject("/ASCII85Decode"), NameObject("/FlateDecode")]
    )
    page[NameObject("/Contents")] = writer._add_object(stream)
    writer.write(output)
    return output.getvalue()


def _sleeping_process_worker(send_connection, seconds: float) -> None:
    time.sleep(seconds)
    try:
        send_connection.send(("ok", "late worker result"))
    finally:
        send_connection.close()


class BoundedDocumentExtractorTests(unittest.IsolatedAsyncioTestCase):
    def tearDown(self) -> None:
        bounded_document_extractor._reset_document_parse_gate_for_tests()

    async def test_docx_preflight_rejects_entry_path_total_and_ratio_before_parser(self):
        cases = (
            (
                _docx_bytes(
                    [("a.xml", b"x"), ("b.xml", b"x"), ("c.xml", b"x")]
                ),
                {"MAX_DOCX_ENTRY_COUNT": 2},
            ),
            (
                _docx_bytes([("../word/document.xml", b"<doc/>")]),
                {},
            ),
            (
                _docx_bytes([("word/document.xml", b"x" * 256)]),
                {"MAX_DOCX_TOTAL_UNCOMPRESSED_BYTES": 128},
            ),
            (
                _docx_bytes([("word/document.xml", b"x" * 8_192)]),
                {
                    "MAX_DOCX_COMPRESSION_RATIO": 2.0,
                    "DOCX_RATIO_CHECK_MIN_BYTES": 1,
                },
            ),
        )
        for payload, constants in cases:
            with self.subTest(constants=constants):
                extractor = Mock(return_value="valid extracted text")
                patches = [
                    patch.object(bounded_document_extractor, name, value)
                    for name, value in constants.items()
                ]
                for active_patch in patches:
                    active_patch.start()
                try:
                    with self.assertRaises(DocumentExtractionLimitError):
                        await bounded_document_extractor.extract_document_text_bounded(
                            payload,
                            kind="docx",
                            max_output_chars=100,
                            docx_extractor=extractor,
                        )
                finally:
                    for active_patch in reversed(patches):
                        active_patch.stop()
                extractor.assert_not_called()

    async def test_pdf_preflight_rejects_object_and_unsafe_expansion_filters_before_parser(self):
        object_heavy = (
            b"%PDF-1.4\n"
            + b"\n".join(f"{index} 0 obj".encode() for index in range(4))
            + b"\n%%EOF"
        )
        indirect_lzw_filter = (
            b"%PDF-1.4\n1 0 obj\n<< /Filter 5 0 R >>\nendobj\n"
            b"5 0 obj\n[/ASCII85Decode /LZWDecode]\nendobj\n%%EOF"
        )
        cases = (
            (object_heavy, {"MAX_PDF_OBJECTS": 3}),
            (indirect_lzw_filter, {}),
        )
        for payload, constants in cases:
            with self.subTest(constants=constants):
                extractor = Mock(return_value="valid extracted text")
                patches = [
                    patch.object(bounded_document_extractor, name, value)
                    for name, value in constants.items()
                ]
                for active_patch in patches:
                    active_patch.start()
                try:
                    with self.assertRaises(DocumentExtractionLimitError):
                        await bounded_document_extractor.extract_document_text_bounded(
                            payload,
                            kind="pdf",
                            max_output_chars=100,
                            pdf_extractor=extractor,
                        )
                finally:
                    for active_patch in reversed(patches):
                        active_patch.stop()
                extractor.assert_not_called()

    async def test_sync_parser_runs_off_event_loop(self):
        def slow_extractor(_data: bytes, *, max_output_chars: int) -> str:
            time.sleep(0.05)
            return "x" * min(max_output_chars, 30)

        task = asyncio.create_task(
            bounded_document_extractor.extract_document_text_bounded(
                b"%PDF-1.4\n%%EOF",
                kind="pdf",
                max_output_chars=100,
                pdf_extractor=slow_extractor,
            )
        )
        await asyncio.sleep(0.005)
        self.assertFalse(task.done())
        self.assertEqual(await task, "x" * 30)

    async def test_default_pdf_parser_runs_in_isolated_process_and_reaps_it(self):
        task = asyncio.create_task(
            bounded_document_extractor.extract_document_text_bounded(
                _blank_pdf_bytes(),
                kind="pdf",
                max_output_chars=100,
            )
        )
        await asyncio.sleep(0)
        self.assertFalse(task.done())
        self.assertEqual(await task, "")
        self.assertEqual(
            bounded_document_extractor.active_document_process_ids(),
            set(),
        )

    async def test_ascii85_then_flate_bomb_is_bounded_inside_child_process(self):
        payload = _ascii85_flate_bomb_pdf_bytes()
        self.assertLess(len(payload), bounded_document_extractor.MAX_DOCUMENT_INPUT_BYTES)

        with self.assertRaises(
            (
                DocumentExtractionLimitError,
                bounded_document_extractor.DocumentExtractionInvalidError,
            )
        ):
            await bounded_document_extractor.extract_document_text_bounded(
                payload,
                kind="pdf",
                max_output_chars=100,
            )

        self.assertEqual(
            bounded_document_extractor.active_document_process_ids(),
            set(),
        )

    async def test_cancelled_caller_does_not_release_slot_until_worker_finishes(self):
        release_worker = threading.Event()
        started_count = 0
        started_lock = threading.Lock()

        def blocking_extractor(_data: bytes, *, max_output_chars: int) -> str:
            nonlocal started_count
            with started_lock:
                started_count += 1
            release_worker.wait(timeout=2)
            return "x" * min(max_output_chars, 30)

        with patch.object(bounded_document_extractor, "DOCUMENT_PARSE_CONCURRENCY", 1):
            bounded_document_extractor._reset_document_parse_gate_for_tests()
            first = asyncio.create_task(
                bounded_document_extractor.extract_document_text_bounded(
                    b"%PDF-1.4\n%%EOF",
                    kind="pdf",
                    max_output_chars=100,
                    pdf_extractor=blocking_extractor,
                )
            )
            while started_count < 1:
                await asyncio.sleep(0)
            second = asyncio.create_task(
                bounded_document_extractor.extract_document_text_bounded(
                    b"%PDF-1.4\n%%EOF",
                    kind="pdf",
                    max_output_chars=100,
                    pdf_extractor=blocking_extractor,
                )
            )
            await asyncio.sleep(0.01)
            self.assertEqual(started_count, 1)

            first.cancel()
            with self.assertRaises(asyncio.CancelledError):
                await first
            await asyncio.sleep(0.01)
            self.assertEqual(started_count, 1)

            release_worker.set()
            self.assertEqual(await second, "x" * 30)
            self.assertEqual(started_count, 2)

    async def test_worker_timeout_is_typed_and_bounded(self):
        def slow_extractor(_data: bytes, *, max_output_chars: int) -> str:
            time.sleep(0.05)
            return "x" * min(max_output_chars, 30)

        with patch.object(
            bounded_document_extractor,
            "DOCUMENT_PARSE_TIMEOUT_SECONDS",
            0.005,
        ):
            with self.assertRaises(DocumentExtractionTimeoutError):
                await bounded_document_extractor.extract_document_text_bounded(
                    b"%PDF-1.4\n%%EOF",
                    kind="pdf",
                    max_output_chars=100,
                    pdf_extractor=slow_extractor,
                )
        await asyncio.sleep(0.06)

    async def test_process_timeout_terminates_pid_before_releasing_slot(self):
        started_pids: list[int] = []

        def start_sleeping_process(_data: bytes, _kind: str, _max_chars: int):
            context = __import__("multiprocessing").get_context("spawn")
            receive_connection, send_connection = context.Pipe(duplex=False)
            process = context.Process(
                target=_sleeping_process_worker,
                args=(send_connection, 5.0),
                daemon=True,
            )
            process.start()
            send_connection.close()
            assert process.pid is not None
            started_pids.append(process.pid)
            with bounded_document_extractor._active_process_lock:
                bounded_document_extractor._active_document_process_ids.add(
                    process.pid
                )
            return process, receive_connection

        with (
            patch.object(
                bounded_document_extractor,
                "_start_document_process",
                side_effect=start_sleeping_process,
            ),
            patch.object(
                bounded_document_extractor,
                "DOCUMENT_PARSE_TIMEOUT_SECONDS",
                0.02,
            ),
        ):
            with self.assertRaises(DocumentExtractionTimeoutError):
                await bounded_document_extractor.extract_document_text_bounded(
                    _blank_pdf_bytes(),
                    kind="pdf",
                    max_output_chars=100,
                )

        self.assertTrue(started_pids)
        self.assertEqual(
            bounded_document_extractor.active_document_process_ids(),
            set(),
        )
        self.assertEqual(
            await bounded_document_extractor.extract_document_text_bounded(
                b"%PDF-1.4\n%%EOF",
                kind="pdf",
                max_output_chars=100,
                pdf_extractor=lambda _data, *, max_output_chars: "ready",
            ),
            "ready",
        )

    async def test_cancelled_process_parse_reaps_pid_before_the_slot_is_reused(self):
        started = asyncio.Event()

        def start_sleeping_process(_data: bytes, _kind: str, _max_chars: int):
            context = __import__("multiprocessing").get_context("spawn")
            receive_connection, send_connection = context.Pipe(duplex=False)
            process = context.Process(
                target=_sleeping_process_worker,
                args=(send_connection, 5.0),
                daemon=True,
            )
            process.start()
            send_connection.close()
            assert process.pid is not None
            with bounded_document_extractor._active_process_lock:
                bounded_document_extractor._active_document_process_ids.add(
                    process.pid
                )
            started.set()
            return process, receive_connection

        with patch.object(
            bounded_document_extractor,
            "_start_document_process",
            side_effect=start_sleeping_process,
        ):
            task = asyncio.create_task(
                bounded_document_extractor.extract_document_text_bounded(
                    _blank_pdf_bytes(),
                    kind="pdf",
                    max_output_chars=100,
                )
            )
            await started.wait()
            task.cancel()
            with self.assertRaises(asyncio.CancelledError):
                await task

        self.assertEqual(
            bounded_document_extractor.active_document_process_ids(),
            set(),
        )
        self.assertEqual(
            await bounded_document_extractor.extract_document_text_bounded(
                b"%PDF-1.4\n%%EOF",
                kind="pdf",
                max_output_chars=100,
                pdf_extractor=lambda _data, *, max_output_chars: "ready",
            ),
            "ready",
        )

    async def test_jd_document_has_explicit_maximum_extracted_text(self):
        upload = UploadFile(
            filename="jd.pdf",
            file=io.BytesIO(b"%PDF-1.4\n%%EOF"),
        )
        with patch.object(
            jd_attachment_service,
            "extract_document_text_bounded",
            return_value="x" * (jd_attachment_service.MAX_JD_DOCUMENT_TEXT_CHARS + 1),
        ):
            with self.assertRaises(ValueError):
                await jd_attachment_service.extract_jd_from_attachment(upload)


if __name__ == "__main__":
    unittest.main()
