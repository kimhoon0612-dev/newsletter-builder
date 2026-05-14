"""
내장 뉴스레터 템플릿 모듈.
ISLS 2025 Toronto 등 자주 사용하는 뉴스레터를 항상 불러올 수 있도록
하드코딩된 템플릿을 제공합니다.
"""

BUILTIN_TEMPLATES = {
    "isls-2025-toronto": {
        "id": "isls-2025-toronto",
        "name": "ISLS 2025 Toronto Newsletter",
        "description": "ISLS 2025 Toronto – VODs available to ISLS Members",
        "thumbnail": "https://www.isls-liversurgeon.org/newsletter/images/2026/isls01_01.jpg",
        "sections": [
            {
                "image_url": "https://www.isls-liversurgeon.org/newsletter/images/2026/isls01_01.jpg",
                "click_url": "https://directsend.co.kr/index.php/mail_report_api/click/VTc1MjEzNw/202602/11/0/isls@isls-society.org/38/23279",
                "alt_text": "ISLS Newsletter Header"
            },
            {
                "image_url": "https://www.isls-liversurgeon.org/newsletter/images/2026/isls01_02_v2.jpg",
                "click_url": "https://directsend.co.kr/index.php/mail_report_api/click/VTc1MjEzNw/202602/11/0/isls@isls-society.org/41/23279",
                "alt_text": "ISLS Newsletter Section 2"
            },
            {
                "image_url": "https://www.isls-liversurgeon.org/newsletter/images/2026/isls01_03_v2.jpg",
                "click_url": "https://directsend.co.kr/index.php/mail_report_api/click/VTc1MjEzNw/202602/11/0/isls@isls-society.org/44/23279",
                "alt_text": "ISLS Newsletter Section 3"
            },
            {
                "image_url": "https://www.isls-liversurgeon.org/newsletter/images/2026/isls01_04_v2.jpg",
                "click_url": "https://directsend.co.kr/index.php/mail_report_api/click/VTc1MjEzNw/202602/11/0/isls@isls-society.org/47/23279",
                "alt_text": "ISLS Newsletter Section 4"
            },
            {
                "image_url": "https://www.isls-liversurgeon.org/newsletter/images/2026/isls01_05_v2.jpg",
                "click_url": "",
                "alt_text": "ISLS Newsletter Section 5"
            },
            {
                "image_url": "https://www.isls-liversurgeon.org/newsletter/images/2026/isls01_06.jpg",
                "click_url": "https://directsend.co.kr/index.php/mail_report_api/click/VTc1MjEzNw/202602/11/0/isls@isls-society.org/38/23279",
                "alt_text": "ISLS Newsletter Footer"
            }
        ]
    }
}


def get_builtin_templates():
    """내장 템플릿 목록을 반환합니다. (요약 정보만)"""
    result = []
    for tid, t in BUILTIN_TEMPLATES.items():
        result.append({
            "id": tid,
            "name": t["name"],
            "description": t["description"],
            "thumbnail": t["thumbnail"],
            "section_count": len(t["sections"])
        })
    return result


def get_template(template_id):
    """특정 템플릿의 전체 데이터를 반환합니다."""
    return BUILTIN_TEMPLATES.get(template_id)
