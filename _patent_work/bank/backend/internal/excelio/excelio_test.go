package excelio

import (
	"bytes"
	"io"
	"math"
	"testing"

	"github.com/xuri/excelize/v2"
)

func createMedicalXLSX() io.Reader {
	f := excelize.NewFile()
	sheet := f.GetSheetName(0)
	// headers with varied casing/spaces
	f.SetCellValue(sheet, "A1", "psn_no")
	f.SetCellValue(sheet, "B1", "Psn Name")
	f.SetCellValue(sheet, "C1", " phone ")
	f.SetCellValue(sheet, "D1", "id_card")
	f.SetCellValue(sheet, "E1", "psn_clct_amt")
	f.SetCellValue(sheet, "F1", "cashym")
	// rows
	f.SetCellValue(sheet, "A2", "PN001")
	f.SetCellValue(sheet, "B2", "Alice")
	f.SetCellValue(sheet, "C2", " 13800000000 ")
	f.SetCellValue(sheet, "D2", "ID001")
	f.SetCellValue(sheet, "E2", "1234.56")
	f.SetCellValue(sheet, "F2", "202201")

	f.SetCellValue(sheet, "A3", "PN002")
	f.SetCellValue(sheet, "B3", "Bob")
	f.SetCellValue(sheet, "C3", "")
	f.SetCellValue(sheet, "D3", "ID002")
	f.SetCellValue(sheet, "E3", "notanumber")
	f.SetCellValue(sheet, "F3", "202202")

	buf, _ := f.WriteToBuffer()
	return bytes.NewReader(buf.Bytes())
}

func createBankXLSX() io.Reader {
	f := excelize.NewFile()
	sheet := f.GetSheetName(0)
	f.SetCellValue(sheet, "A1", "bank_user_id")
	f.SetCellValue(sheet, "B1", "name")
	f.SetCellValue(sheet, "C1", "phone")
	f.SetCellValue(sheet, "D1", "id_card")
	f.SetCellValue(sheet, "A2", "B001")
	f.SetCellValue(sheet, "B2", "Alice Bank")
	f.SetCellValue(sheet, "C2", "13800000000")
	f.SetCellValue(sheet, "D2", "ID001")
	buf, _ := f.WriteToBuffer()
	return bytes.NewReader(buf.Bytes())
}

func TestReadMedicalXLSX(t *testing.T) {
	r := createMedicalXLSX()
	rows, err := ReadMedicalXLSX(r)
	if err != nil {
		t.Fatalf("read medical failed: %v", err)
	}
	if len(rows) != 2 {
		t.Fatalf("expected 2 rows got %d", len(rows))
	}
	if rows[0].PsnNo != "PN001" {
		t.Fatalf("unexpected psn_no")
	}
	if rows[0].PsnName != "Alice" {
		t.Fatalf("unexpected psn_name")
	}
	if rows[0].Phone != "13800000000" {
		t.Fatalf("phone trim mismatch: %q", rows[0].Phone)
	}
	if math.IsNaN(rows[1].PsnClctAmt) == false {
		t.Fatalf("expected NaN for non-numeric psn_clct_amt")
	}
}

func TestReadBankXLSX(t *testing.T) {
	r := createBankXLSX()
	rows, err := ReadBankXLSX(r)
	if err != nil {
		t.Fatalf("read bank failed: %v", err)
	}
	if len(rows) != 1 {
		t.Fatalf("expected 1 row got %d", len(rows))
	}
	if rows[0].BankUserID != "B001" {
		t.Fatalf("bank_user_id mismatch")
	}
}

func TestWriteResultXLSX(t *testing.T) {
	rows := []ResultRow{
		{BankUserID: "B001", PsnName: "Alice", Result: 4},
		{BankUserID: "B002", PsnName: "Bob", Result: 1},
	}
	var buf bytes.Buffer
	if err := WriteResultXLSX(&buf, rows); err != nil {
		t.Fatalf("write result failed: %v", err)
	}
	// read back and verify
	f, err := excelize.OpenReader(bytes.NewReader(buf.Bytes()))
	if err != nil {
		t.Fatalf("open result xlsx failed: %v", err)
	}
	sheets := f.GetSheetList()
	if len(sheets) == 0 {
		t.Fatalf("no sheets in result")
	}
	r2, err := f.GetRows(sheets[0])
	if err != nil {
		t.Fatalf("get rows failed: %v", err)
	}
	if len(r2) != 3 { // header + 2 rows
		t.Fatalf("expected 3 rows got %d", len(r2))
	}
	if r2[0][0] != "bank_user_id" || r2[0][1] != "psn_name" || r2[0][2] != "result" {
		t.Fatalf("header mismatch: %v", r2[0])
	}
}


