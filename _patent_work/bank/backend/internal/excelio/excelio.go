package excelio

import (
	"bytes"
	"errors"
	"fmt"
	"io"
	"math"
	"strconv"
	"strings"

	"github.com/xuri/excelize/v2"
)

type MedicalRow struct {
	PsnNo      string
	PsnName    string
	Phone      string
	IDCard     string
	PsnClctAmt float64 // NaN if non-numeric
	Cashym     string
}

type BankRow struct {
	BankUserID string
	Name       string
	Phone      string
	IDCard     string
}

type ResultRow struct {
	BankUserID string
	PsnName    string
	Result     int
}

// normalizeHeader lowercases and removes non-alphanumeric chars for tolerant matching
func normalizeHeader(s string) string {
	s = strings.ToLower(strings.TrimSpace(s))
	// remove spaces, underscores, hyphens
	r := make([]rune, 0, len(s))
	for _, ch := range s {
		if (ch >= 'a' && ch <= 'z') || (ch >= '0' && ch <= '9') {
			r = append(r, ch)
		}
	}
	return string(r)
}

func headerToField(h string) string {
	// h is normalized
	switch {
	case h == "psnno" || h == "psnnumber" || h == "psnno":
		return "psn_no"
	case h == "psnname" || h == "psn_name":
		return "psn_name"
	case strings.Contains(h, "phone"):
		return "phone"
	case strings.Contains(h, "idcard") || strings.Contains(h, "idnumber") || strings.Contains(h, "id"):
		return "id_card"
	case strings.Contains(h, "psnclctamt") || strings.Contains(h, "clctamt") || strings.Contains(h, "psnclct"):
		return "psn_clct_amt"
	case strings.Contains(h, "cashym"):
		return "cashym"
	case strings.Contains(h, "bankuserid") || strings.Contains(h, "bank_user_id") || strings.Contains(h, "bankid"):
		return "bank_user_id"
	case h == "name":
		return "name"
	default:
		return ""
	}
}


type sheetSelection struct {
	Sheet      string
	Rows       [][]string
	ColToField map[int]string
	MatchCount int
}

// selectBestSheet scans sheets and selects the one with the most matching required fields by header names.
// If required is empty, it picks the first sheet.
func selectBestSheet(f *excelize.File, required []string) (sheetSelection, error) {
	sheets := f.GetSheetList()
	if len(sheets) == 0 {
		return sheetSelection{}, errors.New("no sheets")
	}
	if len(required) == 0 {
		rows, err := f.GetRows(sheets[0])
		if err != nil {
			return sheetSelection{}, fmt.Errorf("get rows: %w", err)
		}
		return sheetSelection{Sheet: sheets[0], Rows: rows, ColToField: map[int]string{}, MatchCount: 0}, nil
	}

	best := sheetSelection{MatchCount: -1}
	reqSet := map[string]struct{}{}
	for _, r := range required {
		reqSet[r] = struct{}{}
	}

	for _, sh := range sheets {
		rows, err := f.GetRows(sh)
		if err != nil || len(rows) == 0 {
			continue
		}
		header := rows[0]
		colToField := map[int]string{}
		match := 0
		seen := map[string]struct{}{}
		for i, h := range header {
			n := normalizeHeader(h)
			fld := headerToField(n)
			if fld == "" {
				continue
			}
			colToField[i] = fld
			if _, ok := reqSet[fld]; ok {
				if _, dup := seen[fld]; !dup {
					match++
					seen[fld] = struct{}{}
				}
			}
		}
		if match > best.MatchCount {
			best = sheetSelection{Sheet: sh, Rows: rows, ColToField: colToField, MatchCount: match}
		}
	}

	if best.MatchCount < 0 {
		// fallback to first sheet
		rows, err := f.GetRows(sheets[0])
		if err != nil {
			return sheetSelection{}, fmt.Errorf("get rows: %w", err)
		}
		best = sheetSelection{Sheet: sheets[0], Rows: rows, ColToField: map[int]string{}, MatchCount: 0}
	}
	return best, nil
}

func ReadMedicalXLSX(r io.Reader) ([]MedicalRow, error) {
	f, err := excelize.OpenReader(r)
	if err != nil {
		return nil, fmt.Errorf("open xlsx: %w", err)
	}
	// pick sheet by matching medical columns; supports multi-sheet uploads
	sel, err := selectBestSheet(f, []string{"psn_no","psn_name","phone","id_card","psn_clct_amt"})
	if err != nil {
		return nil, err
	}
	rows := sel.Rows
	if len(rows) == 0 {
		return nil, nil
	}
	colToField := sel.ColToField
	if len(colToField) == 0 {
		header := rows[0]
		colToField = map[int]string{}
		for i, h := range header {
			n := normalizeHeader(h)
			if fld := headerToField(n); fld != "" {
				colToField[i] = fld
			}
		}
	}
	out := make([]MedicalRow, 0, len(rows)-1)
	for ri := 1; ri < len(rows); ri++ {
		row := rows[ri]
		var mr MedicalRow
		mr.PsnClctAmt = math.NaN()
		for ci, cell := range row {
			field, ok := colToField[ci]
			if !ok {
				continue
			}
			val := strings.TrimSpace(cell)
			switch field {
			case "psn_no":
				mr.PsnNo = val
			case "psn_name":
				mr.PsnName = val
			case "phone":
				mr.Phone = strings.TrimSpace(val)
			case "id_card":
				mr.IDCard = strings.TrimSpace(val)
			case "psn_clct_amt":
				if val == "" {
					mr.PsnClctAmt = math.NaN()
				} else {
					if v, err := strconv.ParseFloat(strings.ReplaceAll(val, ",", ""), 64); err == nil {
						mr.PsnClctAmt = v
					} else {
						mr.PsnClctAmt = math.NaN()
					}
				}
			case "cashym":
				mr.Cashym = val
			}
		}
		out = append(out, mr)
	}
	return out, nil
}

func ReadBankXLSX(r io.Reader) ([]BankRow, error) {
	f, err := excelize.OpenReader(r)
	if err != nil {
		return nil, fmt.Errorf("open xlsx: %w", err)
	}
	// pick sheet by matching bank columns; supports multi-sheet uploads
	sel, err := selectBestSheet(f, []string{"bank_user_id","name","phone","id_card"})
	if err != nil {
		return nil, err
	}
	rows := sel.Rows
	if len(rows) == 0 {
		return nil, nil
	}
	colToField := sel.ColToField
	if len(colToField) == 0 {
		header := rows[0]
		colToField = map[int]string{}
		for i, h := range header {
			n := normalizeHeader(h)
			if fld := headerToField(n); fld != "" {
				colToField[i] = fld
			}
		}
	}
	out := make([]BankRow, 0, len(rows)-1)
	for ri := 1; ri < len(rows); ri++ {
		row := rows[ri]
		var br BankRow
		for ci, cell := range row {
			field, ok := colToField[ci]
			if !ok {
				continue
			}
			val := strings.TrimSpace(cell)
			switch field {
			case "bank_user_id":
				br.BankUserID = val
			case "name":
				br.Name = val
			case "phone":
				br.Phone = strings.TrimSpace(val)
			case "id_card":
				br.IDCard = strings.TrimSpace(val)
			}
		}
		out = append(out, br)
	}
	return out, nil
}

func WriteResultXLSX(w io.Writer, rows []ResultRow) error {
	f := excelize.NewFile()
	sheet := f.GetSheetName(0)
	// ensure header exactly as required
	headers := []string{"bank_user_id", "psn_name", "result"}
	for ci, h := range headers {
		col, _ := excelize.ColumnNumberToName(ci + 1)
		if err := f.SetCellValue(sheet, col+"1", h); err != nil {
			return fmt.Errorf("set header: %w", err)
		}
	}
	for ri, r := range rows {
		rowNum := ri + 2
		if err := f.SetCellValue(sheet, "A"+strconv.Itoa(rowNum), r.BankUserID); err != nil {
			return err
		}
		if err := f.SetCellValue(sheet, "B"+strconv.Itoa(rowNum), r.PsnName); err != nil {
			return err
		}
		if err := f.SetCellValue(sheet, "C"+strconv.Itoa(rowNum), r.Result); err != nil {
			return err
		}
	}
	buf, err := f.WriteToBuffer()
	if err != nil {
		return fmt.Errorf("write buffer: %w", err)
	}
	_, err = io.Copy(w, bytes.NewReader(buf.Bytes()))
	return err
}


