# luhn.py - functions for performing the Luhn and Luhn mod N algorithms
#
# Copyright (C) 2010-2021 Arthur de Jong
#
# This library is free software; you can redistribute it and/or
# modify it under the terms of the GNU Lesser General Public
# License as published by the Free Software Foundation; either
# version 2.1 of the License, or (at your option) any later version.
#
# This library is distributed in the hope that it will be useful,
# but WITHOUT ANY WARRANTY; without even the implied warranty of
# MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the GNU
# Lesser General Public License for more details.
#
# You should have received a copy of the GNU Lesser General Public
# License along with this library; if not, write to the Free Software
# Foundation, Inc., 51 Franklin Street, Fifth Floor, Boston, MA
# 02110-1301 USA

"""The Luhn and Luhn mod N algorithms.

The Luhn algorithm is used to detect most accidental errors in various
identification numbers.

>>> validate('7894')
Traceback (most recent call last):
    ...
InvalidChecksum: ...
>>> checksum('7894')
6
>>> calc_check_digit('7894')
'9'
>>> validate('78949')
'78949'

An alternative alphabet can be provided to use the Luhn mod N algorithm.
The default alphabet is '0123456789'.

>>> validate('1234', alphabet='0123456789abcdef')
Traceback (most recent call last):
    ...
InvalidChecksum: ...
>>> checksum('1234', alphabet='0123456789abcdef')
14
"""
from app.extension.celery_task.pipt_task.assets.bankcode import bankcode
from app.extension.celery_task.pipt_task.assets.bin_dict import bin_dict


class ValidationError(ValueError):
    """Top-level error for validating numbers.

    This exception should normally not be raised, only subclasses of this
    exception."""

    def __str__(self):
        """Return the exception message."""
        return ''.join(self.args[:1]) or getattr(self, 'message', '')


class InvalidFormat(ValidationError):  # noqa N818
    """Something is wrong with the format of the number.

    This generally means characters or delimiters that are not allowed are
    part of the number or required parts are missing."""

    message = 'The number has an invalid format.'


class InvalidChecksum(ValidationError):  # noqa N818
    """The number's internal checksum or check digit does not match."""

    message = "The number's checksum or check digit is invalid."


class InvalidLength(InvalidFormat):  # noqa N818
    """The length of the number is wrong."""

    message = 'The number has an invalid length.'


class InvalidComponent(ValidationError):  # noqa N818
    """One of the parts of the number has an invalid reference.

    Some part of the number refers to some external entity like a country
    code, a date or a predefined collection of values. The number contains
    some invalid reference."""

    message = 'One of the parts of the number are invalid or unknown.'


def checksum(number, alphabet='0123456789'):
    """Calculate the Luhn checksum over the provided number. The checksum
    is returned as an int. Valid numbers should have a checksum of 0."""
    n = len(alphabet)
    number = tuple(alphabet.index(i)
                   for i in reversed(str(number)))
    return (sum(number[::2]) +
            sum(sum(divmod(i * 2, n))
                for i in number[1::2])) % n


def validate(number, alphabet='0123456789'):
    """Check if the number provided passes the Luhn checksum."""
    if not bool(number):
        raise InvalidFormat()
    try:
        valid = checksum(number, alphabet) == 0
    except Exception:  # noqa: B902
        raise InvalidFormat()
    if not valid:
        raise InvalidChecksum()
    return number


def is_valid(number, alphabet='0123456789'):
    """Check if the number passes the Luhn checksum."""
    try:
        return bool(validate(number, alphabet))
    except ValidationError:
        return False


def calc_check_digit(number, alphabet='0123456789'):
    """Calculate the extra digit that should be appended to the number to
    make it a valid number."""
    ck = checksum(str(number) + alphabet[0], alphabet)
    return alphabet[-ck]

def card_type(card_code):
    def func(i):
        default_split = card_code[:i]
        t = bankcode.get(default_split, None)
        if not t and i > 6:
            return func(i - 1)
        else:
            return t

    return func(10)

def card_num(card_code):
    """
    经检测，部分BIN码是有一定的覆盖情况的，例如
    中行新加坡分行	6227895	贷记卡	16
    中行新加坡分行	622789	贷记卡	16
    但它们的银行卡位数是一致的，因此，在扫描时，只要有一个bin符合了就可以返回
    不需要穷尽
    """
    def func(i):
        default_split = card_code[:i]
        t = bin_dict.get(default_split, None)
        if not t and i < 10:
            return func(i + 1)
        else:
            return t

    return func(2)
